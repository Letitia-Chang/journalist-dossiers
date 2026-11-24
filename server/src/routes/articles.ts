import { Router } from 'express';
import pool from '../db';

const router = Router();

router.get('/journalist/:journalistId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, journalist_id, title, url, summary, published_at, created_at
     FROM articles WHERE org_id = $1 AND journalist_id = $2
     ORDER BY published_at DESC NULLS LAST, created_at DESC`,
    [req.orgId, req.params.journalistId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { journalistId, title, url, summary, publishedAt } = req.body as {
    journalistId?: number; title?: string; url?: string; summary?: string; publishedAt?: string;
  };
  if (!journalistId || !title) {
    return res.status(400).json({ error: 'journalistId and title are required' });
  }

  const { rows: [journalist] } = await pool.query(
    'SELECT id FROM journalists WHERE id = $1 AND org_id = $2',
    [journalistId, req.orgId],
  );
  if (!journalist) return res.status(404).json({ error: 'Journalist not found' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO articles (org_id, journalist_id, title, url, summary, published_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, journalist_id, title, url, summary, published_at, created_at`,
    [req.orgId, journalistId, title, url ?? '', summary ?? '', publishedAt ?? null],
  );
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { title, url, summary, publishedAt } = req.body as {
    title?: string; url?: string; summary?: string; publishedAt?: string;
  };
  const { rows: [row] } = await pool.query(
    `UPDATE articles SET
       title = COALESCE($1, title),
       url = COALESCE($2, url),
       summary = COALESCE($3, summary),
       published_at = COALESCE($4, published_at)
     WHERE id = $5 AND org_id = $6
     RETURNING id, journalist_id, title, url, summary, published_at, created_at`,
    [title, url, summary, publishedAt, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM articles WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
