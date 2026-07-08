import { Router } from 'express';
import pool from '../db';
import { discoverAndSaveFeeds } from '../services/categoryFeedDiscovery';
import { generatePublicationSuggestions } from '../services/publicationSuggestionService';
import { requireRole } from '../middleware/auth';

const router = Router();
const requireEditor = requireRole('owner', 'admin');

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM publication_suggestions WHERE org_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [req.orgId],
  );
  res.json(rows);
});

router.get('/count', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int as c FROM publication_suggestions WHERE org_id = $1 AND status = 'pending'`,
    [req.orgId],
  );
  res.json({ count: row.c });
});

router.get('/history', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM publication_suggestions WHERE org_id = $1 AND status != 'pending' ORDER BY created_at DESC LIMIT 50`,
    [req.orgId],
  );
  res.json(rows);
});

router.post('/run-now', requireEditor, async (req, res) => {
  res.json({ message: 'Generating publication suggestions…' });
  generatePublicationSuggestions(req.orgId!).catch(err => console.error('[Suggestions] run-now failed:', err.message));
});

router.post('/:id/accept', requireEditor, async (req, res) => {
  const { rows: [suggestion] } = await pool.query(
    'SELECT * FROM publication_suggestions WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId],
  );
  if (!suggestion) return res.status(404).json({ error: 'Not found' });

  const { rows: [existing] } = await pool.query(
    'SELECT id FROM publications WHERE org_id = $1 AND LOWER(name) = LOWER($2)', [req.orgId, suggestion.name],
  );
  if (existing) {
    await pool.query(`UPDATE publication_suggestions SET status = 'accepted' WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, message: 'Already exists — marked as accepted' });
  }

  const { rows: [newPub] } = await pool.query(
    `INSERT INTO publications (org_id, name, url, tier, focus, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.orgId, suggestion.name, suggestion.url || '', suggestion.tier || 'B', suggestion.focus || '', suggestion.rationale || ''],
  );
  await pool.query(`UPDATE publication_suggestions SET status = 'accepted' WHERE id = $1`, [req.params.id]);
  res.json({ success: true, pubId: newPub.id, discoveringFeeds: true });

  // Auto-discover feeds in the background
  discoverAndSaveFeeds(req.orgId!, newPub.id).catch(err =>
    console.error(`[FeedDiscovery] Failed for suggestion "${suggestion.name}":`, err.message)
  );
});

router.post('/:id/reject', requireEditor, async (req, res) => {
  const result = await pool.query(
    `UPDATE publication_suggestions SET status = 'rejected' WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
