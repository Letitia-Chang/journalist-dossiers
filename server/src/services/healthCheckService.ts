import axios from 'axios';
import pool from '../db';

export interface HealthCheckResult {
  checked: number;
  unreachable: number;
}

export async function runHealthChecks(orgId: string): Promise<HealthCheckResult> {
  const { rows: pubs } = await pool.query(
    `SELECT id, name, url FROM publications WHERE org_id = $1 AND active = true AND url IS NOT NULL AND url != ''`,
    [orgId],
  );

  let unreachable = 0;
  for (const pub of pubs) {
    let status: 'healthy' | 'unreachable' = 'unreachable';
    try {
      const res = await axios.head(pub.url, { timeout: 8000, maxRedirects: 3, validateStatus: () => true });
      status = res.status >= 200 && res.status < 400 ? 'healthy' : 'unreachable';
    } catch {
      status = 'unreachable';
    }
    if (status === 'unreachable') unreachable++;
    await pool.query(
      `UPDATE publications SET health_status = $1, last_health_check = NOW() WHERE id = $2 AND org_id = $3`,
      [status, pub.id, orgId],
    );
    await new Promise(r => setTimeout(r, 800));
  }

  // Feeds not checked in 30+ days are treated as inactive — they're likely stale.
  await pool.query(
    `UPDATE publication_feeds SET rss_status = 'inactive'
     WHERE org_id = $1 AND rss_last_checked IS NOT NULL AND rss_last_checked < NOW() - INTERVAL '30 days'`,
    [orgId],
  );

  return { checked: pubs.length, unreachable };
}

export async function getHealthSummary(orgId: string) {
  const [unreachable, inactiveFeeds] = await Promise.all([
    pool.query(
      `SELECT id, name, url, last_health_check FROM publications WHERE org_id = $1 AND health_status = 'unreachable'`,
      [orgId],
    ),
    pool.query(
      `SELECT id, name, rss_url, rss_last_checked FROM publications WHERE org_id = $1 AND rss_status = 'inactive' AND active = true`,
      [orgId],
    ),
  ]);
  return { unreachable: unreachable.rows, inactiveFeeds: inactiveFeeds.rows };
}
