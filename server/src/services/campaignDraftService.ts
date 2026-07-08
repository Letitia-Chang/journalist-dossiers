import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface DraftResult {
  subject: string;
  body: string;
}

function buildRelationshipContext(logs: { type: string; status: string; notes: string; logged_at: string }[]): string {
  if (logs.length === 0) return 'No previous contact. This is a cold outreach.';
  const hasCovered = logs.some(l => l.status === 'Covered');
  if (hasCovered) {
    return 'This journalist has covered us before. This is a warm follow-up — skip introductions and reference the previous coverage if relevant.';
  }
  const hasResponded = logs.some(l => l.status === 'Responded');
  if (hasResponded) {
    return `${logs.length} previous interaction${logs.length !== 1 ? 's' : ''}, and they have responded before. Use a peer-to-peer tone — they already know who we are.`;
  }
  return `${logs.length} previous pitch${logs.length !== 1 ? 'es' : ''} with no response yet. Keep it brief — reference a fresh hook, don't re-pitch the same angle.`;
}

export async function generateCampaignDraft(params: {
  orgId: string;
  journalistId: number;
  campaignBrief: string;
  campaignType: string;
  extraInstructions?: string;
}): Promise<DraftResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { orgId, journalistId, campaignBrief, campaignType, extraInstructions } = params;

  const { rows: [org] } = await pool.query(
    'SELECT company_description, target_verticals FROM organizations WHERE id = $1',
    [orgId],
  );

  const { rows: [journalist] } = await pool.query(
    `SELECT j.name, j.beats, j.bio, p.name as publication_name
     FROM journalists j LEFT JOIN publications p ON p.id = j.publication_id
     WHERE j.id = $1 AND j.org_id = $2`,
    [journalistId, orgId],
  );
  if (!journalist) return null;

  const { rows: articles } = await pool.query(
    'SELECT title FROM articles WHERE org_id = $1 AND journalist_id = $2 ORDER BY published_at DESC NULLS LAST LIMIT 5',
    [orgId, journalistId],
  );

  const { rows: outreachLogs } = await pool.query(
    'SELECT type, status, notes, logged_at FROM outreach_logs WHERE org_id = $1 AND journalist_id = $2 ORDER BY logged_at DESC LIMIT 10',
    [orgId, journalistId],
  );

  const { rows: [style] } = await pool.query(
    'SELECT instructions FROM campaign_type_styles WHERE org_id = $1 AND campaign_type = $2',
    [orgId, campaignType],
  );

  const articlesText = articles.length > 0
    ? articles.map((a, i) => `  ${i + 1}. "${a.title}"`).join('\n')
    : '  No articles on record.';

  const prompt = `You are writing a personalized PR pitch email on behalf of a company, to a specific journalist.

OUR COMPANY:
${org.company_description || 'No company description provided.'}
${(org.target_verticals ?? []).length > 0 ? `Target verticals: ${org.target_verticals.join(', ')}` : ''}

CAMPAIGN TYPE: ${campaignType}
CAMPAIGN BRIEF:
${campaignBrief}

JOURNALIST:
- Name: ${journalist.name}
${journalist.publication_name ? `- Publication: ${journalist.publication_name}` : ''}
${(journalist.beats ?? []).length > 0 ? `- Beats: ${journalist.beats.join(', ')}` : ''}
${journalist.bio ? `- Bio: ${journalist.bio}` : ''}

THEIR RECENT ARTICLES:
${articlesText}

RELATIONSHIP HISTORY:
${buildRelationshipContext(outreachLogs)}

${style?.instructions ? `HOUSE STYLE — ALWAYS FOLLOW THESE INSTRUCTIONS:\n${style.instructions}\n` : ''}${extraInstructions ? `\nADDITIONAL INSTRUCTIONS FOR THIS DRAFT:\n${extraInstructions}\n` : ''}
WRITING GUIDELINES:
- Reference something specific from their actual recent work using ONLY the article titles listed above — do not invent or guess at articles not listed. If none are on record, reference their beat or publication instead.
- Keep the email to 3–4 short paragraphs, under 200 words total.
- Subject line under 8 words, no clickbait.
- No "I hope this email finds you well", no "I'm reaching out because".
- End with one clear, low-pressure ask.

Return ONLY valid JSON — no prose before or after:
{"subject": "...", "body": "..."}`;

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
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    return { subject: parsed.subject, body: parsed.body };
  } catch (err: any) {
    console.error(`[CampaignDraftService] Error for journalist ${journalistId}:`, err.message);
    return null;
  }
}
