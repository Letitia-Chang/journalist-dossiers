import pool from '../db';
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
  if (takeLiveAi(actor, 1) === 0) {
    const message = limitMessage(liveAiStatus(actor));
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of result.scores) {
      await client.query(
        `INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score, rationale, evidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (journalist_id, dimension_id)
         DO UPDATE SET score = $4, rationale = $5, evidence = $6, updated_at = NOW()`,
        [orgId, journalistId, s.dimensionId, s.score, s.rationale, JSON.stringify(s.evidence)],
      );
    }
    const { rows: [{ total }] } = await client.query(
      `SELECT COALESCE(SUM(score), 0)::int as total FROM journalist_scores WHERE org_id = $1 AND journalist_id = $2`,
      [orgId, journalistId],
    );
    await client.query('UPDATE journalists SET total_score = $1, updated_at = NOW() WHERE id = $2', [total, journalistId]);
    await client.query('COMMIT');
    return { ok: true, total, scores: result.scores, reasoning: result.reasoning };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[scoringRunner] save failed', err);
    return { ok: false, status: 500, error: 'Failed to save AI scores' };
  } finally {
    client.release();
  }
}
