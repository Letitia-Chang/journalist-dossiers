import { describe, expect, it } from 'vitest';
import { buildScoringPrompt, parseScoringResponse } from '../src/services/journalistScoring';
import { companyProfileSchema } from '../src/lib/companyProfile';

const dimensions = [
  { id: 1, name: 'Beat relevance', description: 'Beat matches us', weight: 25 },
  { id: 2, name: 'Geography', description: '', weight: 10 },
];
const articles = [
  { title: 'Grid story', url: 'https://news.example.com/grid' },
  { title: 'Other story', url: 'https://news.example.com/other' },
];

describe('buildScoringPrompt', () => {
  const profile = companyProfileSchema.parse({ name: 'Lumen', competitors: ['Acme'], regions: ['US'] });
  const prompt = buildScoringPrompt({
    profile,
    dimensions,
    journalist: { name: 'Dana', publicationName: 'The Ledger', beats: ['Energy'], bio: 'Covers grids.' },
    articles,
  });

  it('is built from the profile, the dimensions and the dossier', () => {
    expect(prompt).toContain('Lumen');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('"Beat relevance" (0–25)');
    expect(prompt).toContain('id 2');
    expect(prompt).toContain('Dana');
    expect(prompt).toContain('The Ledger');
    expect(prompt).toContain('https://news.example.com/grid');
  });

  it('has no hard-coded company: the profile is the only source of company details', () => {
    const other = buildScoringPrompt({
      profile: companyProfileSchema.parse({ name: 'Zenith Widgets', competitors: ['Globex'], regions: ['EU'] }),
      dimensions,
      journalist: { name: 'Dana', publicationName: 'The Ledger', beats: ['Energy'], bio: 'Covers grids.' },
      articles,
    });
    expect(other).toContain('Zenith Widgets');
    expect(other).not.toContain('Lumen');
    expect(other).not.toContain('Acme');
    expect(prompt).not.toContain('Zenith');
  });

  it('asks for one score object per dimension', () => {
    expect(prompt).toContain('"dimensionId": 1');
    expect(prompt).toContain('"dimensionId": 2');
  });

  it('notes when there are no articles', () => {
    const p = buildScoringPrompt({ profile, dimensions, journalist: { name: 'X', beats: [], bio: '' }, articles: [] });
    expect(p).toContain('no articles on record');
  });
});

describe('parseScoringResponse', () => {
  const good = JSON.stringify({
    scores: [
      { dimensionId: 1, score: 20, rationale: 'Covers grids', evidence: ['https://news.example.com/grid'] },
      { dimensionId: 2, score: 7, rationale: 'US only', evidence: [] },
    ],
    reasoning: 'Strong fit',
  });

  it('parses clean JSON', () => {
    const r = parseScoringResponse(good, dimensions, articles)!;
    expect(r.scores).toHaveLength(2);
    expect(r.scores[0]).toMatchObject({ dimensionId: 1, score: 20, rationale: 'Covers grids' });
    expect(r.reasoning).toBe('Strong fit');
  });

  it('tolerates code fences and surrounding prose', () => {
    const r = parseScoringResponse('Here you go:\n```json\n' + good + '\n```\nHope that helps!', dimensions, articles);
    expect(r?.scores).toHaveLength(2);
  });

  it('repairs trailing commas and smart quotes', () => {
    const messy = '{"scores": [{"dimensionId": 1, "score": 12, "rationale": “nice”, "evidence": [],},], "reasoning": "ok",}';
    const r = parseScoringResponse(messy, dimensions, articles);
    expect(r?.scores[0]).toMatchObject({ dimensionId: 1, score: 12 });
  });

  it('clamps scores to each dimension\'s range and rounds', () => {
    const r = parseScoringResponse(JSON.stringify({
      scores: [{ dimensionId: 1, score: 99 }, { dimensionId: 2, score: -4 }],
    }), dimensions, articles)!;
    expect(r.scores.find(s => s.dimensionId === 1)!.score).toBe(25);
    expect(r.scores.find(s => s.dimensionId === 2)!.score).toBe(0);
  });

  it('drops unknown dimensions and duplicates', () => {
    const r = parseScoringResponse(JSON.stringify({
      scores: [{ dimensionId: 9, score: 5 }, { dimensionId: 1, score: 5 }, { dimensionId: 1, score: 20 }],
    }), dimensions, articles)!;
    expect(r.scores).toHaveLength(1);
    expect(r.scores[0].score).toBe(5);
  });

  it('removes evidence URLs the model invented', () => {
    const r = parseScoringResponse(JSON.stringify({
      scores: [{ dimensionId: 1, score: 10, evidence: ['https://news.example.com/grid', 'https://made-up.example/x'] }],
    }), dimensions, articles)!;
    expect(r.scores[0].evidence).toEqual(['https://news.example.com/grid']);
  });

  it('salvages scores from unrecoverable JSON', () => {
    const broken = 'scores: {"dimensionId": 1, "score": 18, "rationale": "cut off... {"dimensionId": 2, "score": 6';
    const r = parseScoringResponse(broken, dimensions, articles)!;
    expect(r.scores.map(s => [s.dimensionId, s.score])).toEqual([[1, 18], [2, 6]]);
  });

  it('returns null when nothing usable is found', () => {
    expect(parseScoringResponse('I cannot help with that.', dimensions, articles)).toBeNull();
    expect(parseScoringResponse('', dimensions, articles)).toBeNull();
  });
});
