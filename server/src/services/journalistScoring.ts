import Anthropic from '@anthropic-ai/sdk';
import { profileToPrompt } from '../lib/companyProfile';
import type { CompanyProfile } from '../lib/companyProfile';
import { assertPromptSize, CLAUDE_MODEL } from '../lib/claude';

export interface DimensionInput {
  id: number;
  name: string;
  description: string;
  weight: number;
}

export interface ArticleInput {
  title: string;
  url: string;
  published_at?: string | null;
}

export interface DimensionScore {
  dimensionId: number;
  score: number;
  rationale: string;
  /** Article URLs supporting the score. Only URLs from the supplied article list survive parsing. */
  evidence: string[];
}

export interface JournalistScoringResult {
  scores: DimensionScore[];
  reasoning: string;
}

export interface ScoringInput {
  profile: CompanyProfile | null;
  dimensions: DimensionInput[];
  journalist: { name: string; publicationName?: string; beats: string[]; bio: string };
  articles: ArticleInput[];
}

/** Build the fit-scoring prompt from the company profile, the org's dimensions and the dossier. */
export function buildScoringPrompt({ profile, dimensions, journalist, articles }: ScoringInput): string {
  const dimensionsList = dimensions
    .map(d => `- id ${d.id} — "${d.name}" (0–${d.weight}): ${d.description || 'no description provided'}`)
    .join('\n');

  const articlesList = articles.length
    ? articles.map((a, i) => `${i + 1}. "${a.title}"${a.published_at ? ` (${a.published_at.slice(0, 10)})` : ''} <${a.url}>`).join('\n')
    : '(no articles on record)';

  return `You are helping a PR team evaluate how well a journalist fits their outreach targets.

${profileToPrompt(profile, 'scoring')}

JOURNALIST:
- Name: ${journalist.name}
${journalist.publicationName ? `- Publication: ${journalist.publicationName}\n` : ''}- Beats: ${journalist.beats.length > 0 ? journalist.beats.join(', ') : 'unknown'}
${journalist.bio ? `- Bio/notes: ${journalist.bio}\n` : ''}
RECENT ARTICLES (the only evidence you may cite):
${articlesList}

SCORING DIMENSIONS (score each on its own 0–max scale):
${dimensionsList}

Instructions:
- Score every dimension. Base each score on the articles above first, then on the beat, publication and bio.
- With no articles on record, estimate cautiously from the beat and publication, and say so in the rationale.
- Each rationale is one short sentence tied to evidence. List the supporting article URLs in "evidence",
  copied exactly from the list above. Never invent URLs; use an empty list when nothing supports the score.

Return ONLY valid JSON, no prose before or after:
{
  "scores": [${dimensions.map(d => `{"dimensionId": ${d.id}, "score": 0, "rationale": "...", "evidence": []}`).join(', ')}],
  "reasoning": "one sentence on the overall fit"
}`;
}

function tryParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* fall through to repairs */ }
  const repaired = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(repaired); } catch { return null; }
}

/**
 * Turn raw model output into validated scores. Tolerates code fences, prose around the
 * JSON, trailing commas and smart quotes; if the JSON is unrecoverable it salvages
 * `dimensionId`/`score` pairs with a regex. Returns null when nothing usable is found.
 */
export function parseScoringResponse(
  text: string,
  dimensions: DimensionInput[],
  articles: ArticleInput[] = [],
): JournalistScoringResult | null {
  const byId = new Map(dimensions.map(d => [d.id, d]));
  const allowedUrls = new Set(articles.map(a => a.url.trim()));
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = objectMatch ? tryParseJson(objectMatch[0]) : null;

  let raw: { dimensionId: unknown; score: unknown; rationale?: unknown; evidence?: unknown }[] = [];
  let reasoning = '';

  if (parsed && Array.isArray(parsed.scores)) {
    raw = parsed.scores;
    reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
  } else {
    // Salvage: pull "dimensionId": N ... "score": M pairs out of malformed output.
    const re = /"?dimensionId"?\s*:\s*(\d+)[^{}]*?"?score"?\s*:\s*(-?\d+(?:\.\d+)?)/g;
    for (const m of cleaned.matchAll(re)) raw.push({ dimensionId: Number(m[1]), score: Number(m[2]) });
  }

  const seen = new Set<number>();
  const scores: DimensionScore[] = [];
  for (const s of raw) {
    const id = Number(s.dimensionId);
    const dim = byId.get(id);
    const value = Number(s.score);
    if (!dim || seen.has(id) || !Number.isFinite(value)) continue;
    seen.add(id);
    const evidence = Array.isArray(s.evidence)
      ? [...new Set(s.evidence.filter((u): u is string => typeof u === 'string').map(u => u.trim()).filter(u => allowedUrls.has(u)))]
      : [];
    scores.push({
      dimensionId: id,
      score: Math.max(0, Math.min(dim.weight, Math.round(value))),
      rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
      evidence,
    });
  }

  return scores.length > 0 ? { scores, reasoning } : null;
}

export async function scoreJournalistWithAI(input: ScoringInput): Promise<JournalistScoringResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (input.dimensions.length === 0) return null;

  const prompt = assertPromptSize(buildScoringPrompt(input));
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    return parseScoringResponse(text, input.dimensions, input.articles);
  } catch (err: any) {
    console.error('[JournalistScoring] Claude error:', err.message);
    return null;
  }
}
