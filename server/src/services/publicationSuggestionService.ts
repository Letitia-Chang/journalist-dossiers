import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PublicationSuggestionResult {
  added: number;
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export async function generatePublicationSuggestions(orgId: string): Promise<PublicationSuggestionResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { added: 0 };

  const { rows: [org] } = await pool.query(
    'SELECT company_description, target_verticals FROM organizations WHERE id = $1',
    [orgId],
  );

  const { rows: existing } = await pool.query('SELECT name, url FROM publications WHERE org_id = $1', [orgId]);
  const { rows: rejected } = await pool.query(
    `SELECT name FROM publication_suggestions WHERE org_id = $1 AND status = 'rejected' AND created_at >= NOW() - INTERVAL '30 days'`,
    [orgId],
  );
  const { rows: pending } = await pool.query(
    `SELECT name FROM publication_suggestions WHERE org_id = $1 AND status = 'pending'`,
    [orgId],
  );

  const existingNames = new Set(existing.map(p => p.name.toLowerCase()));
  const existingDomains = new Set(existing.filter(p => p.url).map(p => extractDomain(p.url)));
  const excludedNames = new Set([
    ...rejected.map(r => r.name.toLowerCase()),
    ...pending.map(r => r.name.toLowerCase()),
  ]);

  const prompt = `You are a media research assistant helping a company find new publications to pitch.

OUR COMPANY:
${org?.company_description || 'No company description provided.'}
${(org?.target_verticals ?? []).length > 0 ? `Target verticals: ${org.target_verticals.join(', ')}` : ''}

PUBLICATIONS ALREADY TRACKED (do not suggest these):
${existing.length > 0 ? existing.map(p => `- ${p.name}`).join('\n') : '(none yet)'}

Suggest up to 5 NEW publications (not already tracked) that would be worth pitching, given our
company's focus. For each, assign a tier:
- A: major national outlets with large audiences directly covering our space
- B: business/trade publications with a dedicated desk relevant to us
- C: regional, niche, or emerging publications/newsletters

Respond with ONLY a valid JSON array, no markdown, no prose:
[{"name": "...", "url": "...", "tier": "A", "focus": "...", "rationale": "one sentence why this fits"}]`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json\s*|\s*```/g, '')
      .trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { added: 0 };

    const suggestions = JSON.parse(jsonMatch[0]) as { name: string; url?: string; tier?: string; focus?: string; rationale?: string }[];

    let added = 0;
    for (const s of suggestions) {
      if (!s.name) continue;
      const nameKey = s.name.toLowerCase();
      if (existingNames.has(nameKey) || excludedNames.has(nameKey)) continue;
      const domain = s.url ? extractDomain(s.url) : '';
      if (domain && existingDomains.has(domain)) continue;

      await pool.query(
        `INSERT INTO publication_suggestions (org_id, name, url, tier, focus, rationale)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, s.name, s.url ?? '', ['A', 'B', 'C'].includes(s.tier ?? '') ? s.tier : 'B', s.focus ?? '', s.rationale ?? ''],
      );
      added++;
    }

    return { added };
  } catch (err: any) {
    console.error('[PublicationSuggestionService] Claude error:', err.message);
    return { added: 0 };
  }
}
