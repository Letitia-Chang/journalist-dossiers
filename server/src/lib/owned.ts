import type { Pool, PoolClient } from 'pg';
import { HttpError } from './httpError';

const TABLES = {
  journalists: 'journalist', campaigns: 'campaign', publications: 'publication', scoring_dimensions: 'scoring dimension',
} as const;

/**
 * Throw unless every id belongs to this organization. Foreign keys only prove a row exists; without
 * this check a request could link to another organization's row and read it back through a join.
 */
export async function assertOwned(
  db: Pool | PoolClient, orgId: string, table: keyof typeof TABLES, ids: (number | null | undefined)[],
): Promise<void> {
  const wanted = [...new Set(ids.filter((i): i is number => i != null))];
  if (wanted.length === 0) return;
  const { rows: [{ c }] } = await db.query(
    `SELECT COUNT(*)::int AS c FROM ${table} WHERE org_id = $1 AND id = ANY($2::int[])`, [orgId, wanted],
  );
  if (c !== wanted.length) throw new HttpError(400, `Unknown ${TABLES[table]}`);
}
