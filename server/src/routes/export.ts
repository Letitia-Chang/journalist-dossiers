import { Router } from 'express';
import pool from '../db';

const router = Router();

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','));
  return lines.join('\n');
}

function sendCsv(res: any, filename: string, rows: Record<string, any>[]) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}

router.get('/journalists', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.id, j.name, p.name as publication, j.email, j.twitter, j.linkedin,
            array_to_string(j.beats, '; ') as beats, j.total_score, j.is_favorite,
            COALESCE((SELECT ol.status FROM outreach_logs ol WHERE ol.journalist_id = j.id AND ol.org_id = j.org_id
              ORDER BY ol.logged_at DESC LIMIT 1), 'Not Started') as outreach_status,
            j.created_at
     FROM journalists j LEFT JOIN publications p ON p.id = j.publication_id
     WHERE j.org_id = $1 ORDER BY j.name ASC`,
    [req.orgId],
  );
  sendCsv(res, 'journalists.csv', rows);
});

router.get('/articles', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, j.name as journalist, a.title, a.url, a.summary, a.published_at
     FROM articles a JOIN journalists j ON j.id = a.journalist_id
     WHERE a.org_id = $1 ORDER BY a.published_at DESC NULLS LAST`,
    [req.orgId],
  );
  sendCsv(res, 'articles.csv', rows);
});

router.get('/outreach', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ol.id, j.name as journalist, ol.type, ol.status, ol.notes, ol.logged_at, u.name as logged_by
     FROM outreach_logs ol
     JOIN journalists j ON j.id = ol.journalist_id
     LEFT JOIN users u ON u.id = ol.logged_by
     WHERE ol.org_id = $1 ORDER BY ol.logged_at DESC`,
    [req.orgId],
  );
  sendCsv(res, 'outreach_logs.csv', rows);
});

export default router;
