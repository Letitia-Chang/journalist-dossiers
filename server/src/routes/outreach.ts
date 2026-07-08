import { Router } from 'express';
import pool from '../db';

const router = Router();

// GET /api/outreach/activity — chronological feed across all journalists
router.get('/activity', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ol.id, ol.journalist_id, ol.campaign_id, ol.type, ol.status, ol.notes, ol.logged_at,
            j.name as journalist_name, p.name as publication_name,
            u.name as logged_by_name
     FROM outreach_logs ol
     JOIN journalists j ON j.id = ol.journalist_id
     LEFT JOIN publications p ON p.id = j.publication_id
     LEFT JOIN users u ON u.id = ol.logged_by
     WHERE ol.org_id = $1
     ORDER BY ol.logged_at DESC
     LIMIT 100`,
    [req.orgId],
  );
  res.json(rows);
});

// GET /api/outreach/journalist/:journalistId — history for one journalist
router.get('/journalist/:journalistId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ol.id, ol.journalist_id, ol.campaign_id, ol.type, ol.status, ol.notes, ol.logged_at,
            u.name as logged_by_name
     FROM outreach_logs ol
     LEFT JOIN users u ON u.id = ol.logged_by
     WHERE ol.org_id = $1 AND ol.journalist_id = $2
     ORDER BY ol.logged_at DESC`,
    [req.orgId, req.params.journalistId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { journalistId, campaignId, type, status, notes } = req.body as {
    journalistId?: number; campaignId?: number; type?: string; status?: string; notes?: string;
  };
  if (!journalistId || !type || !status) {
    return res.status(400).json({ error: 'journalistId, type, and status are required' });
  }

  const { rows: [journalist] } = await pool.query(
    'SELECT id FROM journalists WHERE id = $1 AND org_id = $2',
    [journalistId, req.orgId],
  );
  if (!journalist) return res.status(404).json({ error: 'Journalist not found' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO outreach_logs (org_id, journalist_id, campaign_id, logged_by, type, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, journalist_id, campaign_id, type, status, notes, logged_at`,
    [req.orgId, journalistId, campaignId ?? null, req.userId, type, status, notes ?? ''],
  );
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { type, status, notes } = req.body as { type?: string; status?: string; notes?: string };
  const { rows: [row] } = await pool.query(
    `UPDATE outreach_logs SET
       type = COALESCE($1, type),
       status = COALESCE($2, status),
       notes = COALESCE($3, notes)
     WHERE id = $4 AND org_id = $5
     RETURNING id, journalist_id, campaign_id, type, status, notes, logged_at`,
    [type, status, notes, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM outreach_logs WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
