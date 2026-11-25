import { Router } from 'express';
import pool from '../db';
import { runAiScoring } from '../services/scoringRunner';
import { clientIp } from '../lib/clientIp';
import { HttpError } from '../lib/httpError';
import { assertOwned } from '../lib/owned';
import { recomputeTotals } from '../lib/scores';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const router = Router();
validateParams(router, { id: 'int' });

interface ScoreRow { dimensionId: number; score: number; rationale: string; evidence: string[] }

async function attachScores(orgId: string, journalistIds: number[]) {
  if (journalistIds.length === 0) return new Map<number, ScoreRow[]>();
  const { rows } = await pool.query(
    `SELECT s.journalist_id, s.dimension_id, s.score, s.rationale, s.evidence
     FROM journalist_scores s JOIN scoring_dimensions d ON d.id = s.dimension_id
     WHERE s.org_id = $1 AND s.journalist_id = ANY($2::int[])
     ORDER BY d.display_order, d.id`,
    [orgId, journalistIds],
  );
  const map = new Map<number, ScoreRow[]>();
  for (const r of rows) {
    const list = map.get(r.journalist_id) ?? [];
    list.push({ dimensionId: r.dimension_id, score: r.score, rationale: r.rationale ?? '', evidence: r.evidence ?? [] });
    map.set(r.journalist_id, list);
  }
  return map;
}

// outreach_status is derived from the latest outreach_logs row, never stored —
// avoids the sync-bug class the old app had with a separately-maintained status column.
const OUTREACH_STATUS_SELECT = `COALESCE((
  SELECT ol.status FROM outreach_logs ol
  WHERE ol.journalist_id = j.id AND ol.org_id = j.org_id
  ORDER BY ol.logged_at DESC LIMIT 1
), 'Not Started') as outreach_status`;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.id, j.publication_id, j.name, j.email, j.twitter, j.linkedin, j.bio, j.beats, j.total_score,
            j.is_favorite, j.photo_url, j.created_at, j.updated_at, ${OUTREACH_STATUS_SELECT}
     FROM journalists j WHERE j.org_id = $1
     ORDER BY j.total_score DESC, j.name ASC`,
    [req.orgId],
  );
  const scoresByJournalist = await attachScores(req.orgId!, rows.map(r => r.id));
  res.json(rows.map(r => ({ ...r, scores: scoresByJournalist.get(r.id) ?? [] })));
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT j.id, j.publication_id, j.name, j.email, j.twitter, j.linkedin, j.bio, j.beats, j.total_score,
            j.is_favorite, j.photo_url, j.created_at, j.updated_at, ${OUTREACH_STATUS_SELECT}
     FROM journalists j WHERE j.id = $1 AND j.org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const scoresByJournalist = await attachScores(req.orgId!, [row.id]);
  res.json({ ...row, scores: scoresByJournalist.get(row.id) ?? [] });
});

/** Save hand-entered scores. Changing a score drops the AI's rationale, which no longer explains it. */
async function saveManualScores(
  client: import('pg').PoolClient,
  orgId: string,
  journalistId: number,
  scores: { dimensionId: number; score: number }[],
) {
  const { rows: dims } = await client.query('SELECT id, name, weight FROM scoring_dimensions WHERE org_id = $1', [orgId]);
  const byId = new Map(dims.map(d => [d.id as number, d]));
  for (const s of scores) {
    const dim = byId.get(s.dimensionId);
    if (!dim) throw new HttpError(400, 'Unknown scoring dimension');
    if (s.score > dim.weight) throw new HttpError(400, `${dim.name} can be at most ${dim.weight}`);
    await client.query(
      `INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (journalist_id, dimension_id) DO UPDATE SET
         score = $4, updated_at = NOW(),
         rationale = CASE WHEN journalist_scores.score = $4 THEN journalist_scores.rationale ELSE '' END,
         evidence = CASE WHEN journalist_scores.score = $4 THEN journalist_scores.evidence ELSE '[]'::jsonb END`,
      [orgId, journalistId, s.dimensionId, s.score],
    );
  }
  return recomputeTotals(client, orgId, journalistId);
}

router.post('/', async (req, res) => {
  const { name, publicationId, email, twitter, linkedin, bio, beats, photoUrl, scores } = parseBody(schemas.journalistCreate, req);
  await assertOwned(pool, req.orgId!, 'publications', [publicationId]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(
      `INSERT INTO journalists (org_id, publication_id, name, email, twitter, linkedin, bio, beats, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, publication_id, name, email, twitter, linkedin, bio, beats, total_score, is_favorite, photo_url, created_at, updated_at`,
      [req.orgId, publicationId ?? null, name, email ?? '', twitter ?? '', linkedin ?? '', bio ?? '', beats ?? [], photoUrl ?? ''],
    );
    let totalScore = 0;
    if (scores?.length) {
      totalScore = await saveManualScores(client, req.orgId!, row.id, scores);
    }
    await client.query('COMMIT');
    res.status(201).json({ ...row, total_score: totalScore, scores: scores ?? [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { name, publicationId, email, twitter, linkedin, bio, beats, photoUrl, isFavorite, scores } = parseBody(schemas.journalistUpdate, req);
  await assertOwned(pool, req.orgId!, 'publications', [publicationId]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(
      `UPDATE journalists SET
         publication_id = CASE WHEN $12 THEN $1 ELSE publication_id END,
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         twitter = COALESCE($4, twitter),
         linkedin = COALESCE($5, linkedin),
         bio = COALESCE($6, bio),
         beats = COALESCE($7, beats),
         photo_url = COALESCE($8, photo_url),
         is_favorite = COALESCE($9, is_favorite),
         updated_at = NOW()
       WHERE id = $10 AND org_id = $11
       RETURNING id, publication_id, name, email, twitter, linkedin, bio, beats, total_score, is_favorite, photo_url, created_at, updated_at`,
      [publicationId, name, email, twitter, linkedin, bio, beats, photoUrl, isFavorite, req.params.id, req.orgId, publicationId !== undefined],
    );
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    let totalScore = row.total_score;
    if (scores?.length) {
      totalScore = await saveManualScores(client, req.orgId!, row.id, scores);
    }
    await client.query('COMMIT');
    const scoresByJournalist = await attachScores(req.orgId!, [row.id]);
    res.json({ ...row, total_score: totalScore, scores: scoresByJournalist.get(row.id) ?? [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/:id/score', async (req, res) => {
  const outcome = await runAiScoring(req.orgId!, Number(req.params.id), clientIp(req));
  if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

  const scoresByJournalist = await attachScores(req.orgId!, [Number(req.params.id)]);
  res.json({
    id: Number(req.params.id),
    total_score: outcome.total,
    scores: scoresByJournalist.get(Number(req.params.id)) ?? [],
    reasoning: outcome.reasoning,
    cached: outcome.cached ?? false,
  });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM journalists WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
