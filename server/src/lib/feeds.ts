import type { Pool, PoolClient } from 'pg';

/**
 * Scans read `publication_feeds`, so a publication's main RSS address needs a row there too. Replaces
 * the previous main feed; feeds added or discovered separately are left alone.
 */
export async function setMainFeed(db: Pool | PoolClient, orgId: string, publicationId: number, rssUrl: string): Promise<void> {
  await db.query(
    `DELETE FROM publication_feeds WHERE org_id = $1 AND publication_id = $2 AND feed_type = 'main' AND feed_url <> $3`,
    [orgId, publicationId, rssUrl],
  );
  if (!rssUrl) return;
  await db.query(
    `INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
     SELECT $1, $2, $3, 'Main', 'main'
     WHERE NOT EXISTS (SELECT 1 FROM publication_feeds WHERE publication_id = $2 AND feed_url = $3)`,
    [orgId, publicationId, rssUrl],
  );
}
