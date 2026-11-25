import pool, { inTransaction } from '../db';
import { lockJournalists, recomputeTotals } from '../lib/scores';
import { loadProfile } from '../lib/companyProfile';
import { scoreJournalistWithAI } from './journalistScoring';
import { limitMessage, liveAiStatus, takeLiveAi } from '../demo/limits';
import type { DimensionScore } from './journalistScoring';

export type ScoringOutcome =
  | { ok: true; total: number; scores: DimensionScore[]; reasoning: string; cached?: boolean }
  | { ok: false; status: number; error: string };

/**
 * Score one journalist against the org's dimensions using the company profile and the
 * journalist's recorded articles, then persist the per-dimension scores and the total.
 * This is the single entry point for AI scoring (manual button and auto-score on accept).
 */
export async function runAiScoring(orgId: string, journalistId: number, actor = 'local'): Promise<ScoringOutcome> {
  const { rows: [journalist] } = await pool.query(
    `SELECT j.id, j.name, j.beats, j.bio, p.name as publication_name
     FROM journalists j LEFT JOIN publications p ON p.id = j.publication_id
     WHERE j.id = $1 AND j.org_id = $2`,
    [journalistId, orgId],
  );
  if (!journalist) return { ok: false, status: 404, error: 'Not found' };

  const { rows: dimensions } = await pool.query(
    'SELECT id, name, description, weight FROM scoring_dimensions WHERE org_id = $1 ORDER BY display_order ASC, id ASC',
    [orgId],
  );
  if (dimensions.length === 0) {
    return { ok: false, status: 400, error: 'Define at least one scoring dimension before scoring with AI.' };
  }

  // Demo safeguard: over the limit, fall back to the saved (seeded) analysis if there is one.
  if ((await takeLiveAi(actor, 1)) === 0) {
    const message = limitMessage(await liveAiStatus(actor));
    const { rows: saved } = await pool.query(
      'SELECT dimension_id, score, rationale, evidence FROM journalist_scores WHERE org_id = $1 AND journalist_id = $2',
      [orgId, journalistId],
    );
    if (saved.length === 0) return { ok: false, status: 429, error: message };
    const { rows: [{ total }] } = await pool.query(
      'SELECT COALESCE(SUM(score), 0)::int AS total FROM journalist_scores WHERE org_id = $1 AND journalist_id = $2',
      [orgId, journalistId],
    );
    return {
      ok: true, cached: true, total,
      scores: saved.map(r => ({ dimensionId: r.dimension_id, score: r.score, rationale: r.rationale, evidence: r.evidence })),
      reasoning: `${message} Showing the saved analysis.`,
    };
  }

  const { rows: articles } = await pool.query(
    `SELECT title, url, published_at FROM articles
     WHERE org_id = $1 AND journalist_id = $2 AND url != ''
     ORDER BY published_at DESC NULLS LAST LIMIT 10`,
    [orgId, journalistId],
  );

  const profile = await loadProfile(orgId);
  const result = await scoreJournalistWithAI({
    profile,
    dimensions,
    journalist: {
      name: journalist.name,
      publicationName: journalist.publication_name ?? undefined,
      beats: journalist.beats ?? [],
      bio: journalist.bio ?? '',
    },
    articles: articles.map(a => ({ title: a.title, url: a.url, published_at: a.published_at ? new Date(a.published_at).toISOString() : null })),
  });
  if (!result) {
    return { ok: false, status: 502, error: 'AI scoring failed. Check ANTHROPIC_API_KEY and server logs.' };
  }

  const total = await inTransaction(async db => {
    await lockJournalists(db, orgId, journalistId);
    for (const s of result.scores) {
      // The model ran for seconds: skip a dimension deleted meanwhile, and respect a lowered maximum.
      await db.query(
        `INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score, rationale, evidence)
         SELECT $1, $2, d.id, LEAST($4, d.weight), $5, $6 FROM scoring_dimensions d WHERE d.id = $3 AND d.org_id = $1
         ON CONFLICT (journalist_id, dimension_id)
         DO UPDATE SET score = EXCLUDED.score, rationale = EXCLUDED.rationale, evidence = EXCLUDED.evidence, updated_at = NOW()`,
        [orgId, journalistId, s.dimensionId, s.score, s.rationale, JSON.stringify(s.evidence)],
      );
    }
    return recomputeTotals(db, orgId, journalistId);
  });
  return { ok: true, total, scores: result.scores, reasoning: result.reasoning };
}
