import { Router } from 'express';
import pool from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const orgId = req.orgId;

  const [
    totalRes, avgScoreRes, activeCampaignsRes, draftsReadyRes, sentThisWeekRes,
    recentOutreachRes, recentCampaignsRes, recentCoverageRes, warmContactsRes,
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int as c FROM journalists WHERE org_id = $1', [orgId]),
    pool.query('SELECT AVG(total_score)::numeric(6,1) as avg FROM journalists WHERE org_id = $1', [orgId]),
    pool.query("SELECT COUNT(*)::int as c FROM campaigns WHERE org_id = $1 AND status NOT IN ('completed', 'archived')", [orgId]),
    pool.query("SELECT COUNT(*)::int as c FROM campaign_journalists WHERE org_id = $1 AND status = 'ready'", [orgId]),
    pool.query(
      "SELECT COUNT(*)::int as c FROM outreach_logs WHERE org_id = $1 AND type = 'pitch' AND logged_at >= NOW() - INTERVAL '7 days'",
      [orgId],
    ),
    pool.query(
      `SELECT ol.id, ol.type, ol.status, ol.notes, ol.logged_at, j.id as journalist_id, j.name as journalist_name
       FROM outreach_logs ol JOIN journalists j ON j.id = ol.journalist_id
       WHERE ol.org_id = $1 ORDER BY ol.logged_at DESC LIMIT 8`,
      [orgId],
    ),
    pool.query(
      `SELECT c.id, c.name, c.campaign_type, c.status,
              COUNT(cj.id)::int as journalist_count,
              SUM(CASE WHEN cj.status = 'sent' THEN 1 ELSE 0 END)::int as sent_count
       FROM campaigns c LEFT JOIN campaign_journalists cj ON cj.campaign_id = c.id
       WHERE c.org_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 5`,
      [orgId],
    ),
    pool.query(
      `SELECT id, title, url, published_at FROM coverage
       WHERE org_id = $1 ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 5`,
      [orgId],
    ),
    pool.query(
      `SELECT j.id, j.name, j.total_score, COALESCE((
         SELECT ol.status FROM outreach_logs ol
         WHERE ol.journalist_id = j.id AND ol.org_id = j.org_id
         ORDER BY ol.logged_at DESC LIMIT 1
       ), 'Not Started') as outreach_status
       FROM journalists j WHERE j.org_id = $1`,
      [orgId],
    ),
  ]);

  res.json({
    totalJournalists: totalRes.rows[0].c,
    avgScore: avgScoreRes.rows[0].avg ? Math.round(Number(avgScoreRes.rows[0].avg)) : 0,
    activeCampaigns: activeCampaignsRes.rows[0].c,
    draftsReady: draftsReadyRes.rows[0].c,
    sentThisWeek: sentThisWeekRes.rows[0].c,
    recentOutreach: recentOutreachRes.rows,
    recentCampaigns: recentCampaignsRes.rows,
    recentCoverage: recentCoverageRes.rows,
    warmContacts: warmContactsRes.rows.filter(j => ['Responded', 'Covered'].includes(j.outreach_status)).slice(0, 6),
  });
});

export default router;
