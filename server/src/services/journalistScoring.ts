import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DimensionInput {
  id: number;
  name: string;
  description: string;
  weight: number;
}

export interface JournalistScoringResult {
  scores: { dimensionId: number; score: number }[];
  reasoning: string;
}

export async function scoreJournalistWithAI(params: {
  companyDescription: string;
  targetVerticals: string[];
  dimensions: DimensionInput[];
  journalistName: string;
  publicationName?: string;
  beats: string[];
  bio: string;
}): Promise<JournalistScoringResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (params.dimensions.length === 0) return null;

  const { companyDescription, targetVerticals, dimensions, journalistName, publicationName, beats, bio } = params;

  const dimensionsList = dimensions
    .map(d => `- "${d.name}" (0–${d.weight}): ${d.description || 'no description provided'}`)
    .join('\n');

  const prompt = `You are helping a PR team evaluate how well a journalist fits their outreach targets.

OUR COMPANY:
${companyDescription || 'No company description provided.'}
${targetVerticals.length > 0 ? `Target verticals: ${targetVerticals.join(', ')}` : ''}

JOURNALIST:
- Name: ${journalistName}
${publicationName ? `- Publication: ${publicationName}` : ''}
${beats.length > 0 ? `- Beats: ${beats.join(', ')}` : '- Beats: unknown'}
${bio ? `- Bio/notes: ${bio}` : ''}

SCORING DIMENSIONS (score each on its own 0–max scale):
${dimensionsList}

Based on what you know about this journalist, their publication, and beat, score them on each
dimension above. If you don't have specific knowledge of this exact journalist, use the beat,
publication, and bio information to make a reasonable estimate — do not default everything to 0.

Return ONLY valid JSON — no prose before or after:
{
  "scores": [${dimensions.map(d => `{"dimensionId": ${d.id}, "score": 0}`).join(', ')}],
  "reasoning": "one sentence explaining the overall scoring"
}`;

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

    const parsed = JSON.parse(jsonMatch[0]) as JournalistScoringResult;

    // Clamp each score to its dimension's valid range and drop unknown dimension ids.
    const dimensionById = new Map(dimensions.map(d => [d.id, d]));
    parsed.scores = parsed.scores
      .filter(s => dimensionById.has(s.dimensionId))
      .map(s => ({
        dimensionId: s.dimensionId,
        score: Math.max(0, Math.min(dimensionById.get(s.dimensionId)!.weight, Math.round(s.score))),
      }));

    return parsed;
  } catch (err: any) {
    console.error('[JournalistScoring] Claude error:', err.message);
    return null;
  }
}
