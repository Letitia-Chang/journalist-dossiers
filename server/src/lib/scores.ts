import type { Pool, PoolClient } from 'pg';

/** A journalist's total is always the sum of their saved dimension scores. Recompute after any change. */
export async function recomputeTotals(db: Pool | PoolClient, orgId: string, journalistId?: number): Promise<number> {
  const { rows } = await db.query(
    `UPDATE journalists j SET total_score = COALESCE((
       SELECT SUM(s.score) FROM journalist_scores s WHERE s.journalist_id = j.id AND s.org_id = j.org_id), 0)::int, updated_at = NOW()
     WHERE j.org_id = $1 AND ($2::int IS NULL OR j.id = $2)
     RETURNING total_score`,
    [orgId, journalistId ?? null],
  );
  return rows[0]?.total_score ?? 0;
}

/**
 * Lock journalist rows before touching their scores. Every writer takes journalists first, in id
 * order, then scores, so they queue instead of deadlocking.
 */
export async function lockJournalists(db: PoolClient, orgId: string, journalistId?: number): Promise<void> {
  await db.query(
    'SELECT id FROM journalists WHERE org_id = $1 AND ($2::int IS NULL OR id = $2) ORDER BY id FOR UPDATE',
    [orgId, journalistId ?? null],
  );
}
