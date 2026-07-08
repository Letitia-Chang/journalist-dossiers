import { Router } from 'express';
import pool from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.url, c.notes, c.published_at, c.created_at,
            c.campaign_id, c.journalist_id,
            j.name as journalist_name, p.name as publication_name,
            cam.name as campaign_name
     FROM coverage c
     LEFT JOIN journalists j ON j.id = c.journalist_id
     LEFT JOIN publications p ON p.id = j.publication_id
     LEFT JOIN campaigns cam ON cam.id = c.campaign_id
     WHERE c.org_id = $1
     ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC`,
    [req.orgId],
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT id, title, url, notes, published_at, created_at, campaign_id, journalist_id FROM coverage WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { title, url, notes, publishedAt, journalistId, campaignId } = req.body as {
    title?: string; url?: string; notes?: string; publishedAt?: string;
    journalistId?: number; campaignId?: number;
  };
  if (!title) return res.status(400).json({ error: 'title is required' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO coverage (org_id, title, url, notes, published_at, journalist_id, campaign_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, url, notes, published_at, created_at, campaign_id, journalist_id`,
    [req.orgId, title, url ?? '', notes ?? '', publishedAt ?? null, journalistId ?? null, campaignId ?? null],
  );
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { title, url, notes, publishedAt, journalistId, campaignId } = req.body as {
    title?: string; url?: string; notes?: string; publishedAt?: string;
    journalistId?: number | null; campaignId?: number | null;
  };
  const { rows: [row] } = await pool.query(
    `UPDATE coverage SET
       title = COALESCE($1, title),
       url = COALESCE($2, url),
       notes = COALESCE($3, notes),
       published_at = COALESCE($4, published_at),
       journalist_id = COALESCE($5, journalist_id),
       campaign_id = COALESCE($6, campaign_id)
     WHERE id = $7 AND org_id = $8
     RETURNING id, title, url, notes, published_at, created_at, campaign_id, journalist_id`,
    [title, url, notes, publishedAt, journalistId, campaignId, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM coverage WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
