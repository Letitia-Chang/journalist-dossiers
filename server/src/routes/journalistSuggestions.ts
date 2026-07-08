import { Router } from 'express';
import pool from '../db';
import { scanPublicationRss, scanAllRssFeeds } from '../services/rssService';
import { scanStaffPage } from '../services/staffPageScanner';
import { scoreJournalistWithAI } from '../services/journalistScoring';
import { requireRole } from '../middleware/auth';

const router = Router();
const requireEditor = requireRole('owner', 'admin');

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT js.*, p.name as publication_name FROM journalist_suggestions js
     LEFT JOIN publications p ON p.id = js.publication_id
     WHERE js.org_id = $1 AND js.status = 'pending' ORDER BY js.created_at DESC`,
    [req.orgId],
  );
  res.json(rows);
});

router.get('/count', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int as c FROM journalist_suggestions WHERE org_id = $1 AND status = 'pending'`,
    [req.orgId],
  );
  res.json({ count: row.c });
});

router.get('/history', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT js.*, p.name as publication_name FROM journalist_suggestions js
     LEFT JOIN publications p ON p.id = js.publication_id
     WHERE js.org_id = $1 AND js.status != 'pending' ORDER BY js.created_at DESC LIMIT 100`,
    [req.orgId],
  );
  res.json(rows);
});

router.post('/:id/accept', async (req, res) => {
  const { rows: [suggestion] } = await pool.query(
    'SELECT * FROM journalist_suggestions WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId],
  );
  if (!suggestion) return res.status(404).json({ error: 'Not found' });

  const { rows: [existing] } = await pool.query(
    'SELECT id FROM journalists WHERE org_id = $1 AND publication_id = $2 AND LOWER(name) = LOWER($3)',
    [req.orgId, suggestion.publication_id, suggestion.name],
  );
  if (existing) {
    await pool.query(`UPDATE journalist_suggestions SET status = 'accepted' WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, duplicate: true, message: 'Journalist already exists — marked accepted' });
  }

  const bio = suggestion.recent_article_url
    ? `Discovered via ${suggestion.source_type === 'staffpage' ? 'staff page scan' : 'RSS'}. Recent article: ${suggestion.recent_article_title} — ${suggestion.recent_article_url}`
    : `Discovered via ${suggestion.source_type === 'staffpage' ? 'staff page scan' : 'RSS scan'}.`;

  const { rows: [journalist] } = await pool.query(
    `INSERT INTO journalists (org_id, name, publication_id, beats, bio)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, suggestion.name, suggestion.publication_id, suggestion.suggested_beat ? [suggestion.suggested_beat] : [], bio],
  );

  await pool.query(`UPDATE journalist_suggestions SET status = 'accepted' WHERE id = $1`, [req.params.id]);

  // Seed articles from the suggestion's discovered article list
  let allArticles: { title: string; url: string; date: string }[] = [];
  try {
    allArticles = suggestion.all_articles ? JSON.parse(suggestion.all_articles) : [];
    if (allArticles.length === 0 && suggestion.recent_article_title && suggestion.recent_article_url) {
      allArticles = [{ title: suggestion.recent_article_title, url: suggestion.recent_article_url, date: suggestion.recent_article_date }];
    }
    for (const a of allArticles) {
      if (!a.title) continue;
      await pool.query(
        `INSERT INTO articles (org_id, journalist_id, title, url, published_at) VALUES ($1, $2, $3, $4, $5)`,
        [req.orgId, journalist.id, a.title, a.url ?? '', a.date || null],
      );
    }
  } catch { /* non-fatal — article seeding is best-effort */ }

  res.status(201).json({ success: true, journalistId: journalist.id });

  // Background: auto-score with AI using the org's own scoring dimensions, if any are defined
  const { rows: dimensions } = await pool.query(
    'SELECT id, name, description, weight FROM scoring_dimensions WHERE org_id = $1 ORDER BY display_order ASC, id ASC',
    [req.orgId],
  );
  if (dimensions.length > 0) {
    const { rows: [org] } = await pool.query('SELECT company_description, target_verticals FROM organizations WHERE id = $1', [req.orgId]);
    const { rows: [pub] } = await pool.query('SELECT name FROM publications WHERE id = $1', [suggestion.publication_id]);

    scoreJournalistWithAI({
      companyDescription: org?.company_description ?? '',
      targetVerticals: org?.target_verticals ?? [],
      dimensions,
      journalistName: suggestion.name,
      publicationName: pub?.name,
      beats: suggestion.suggested_beat ? [suggestion.suggested_beat] : [],
      bio,
    }).then(async result => {
      if (!result) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const s of result.scores) {
          await client.query(
            `INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score)
             VALUES ($1, $2, $3, $4) ON CONFLICT (journalist_id, dimension_id) DO UPDATE SET score = $4, updated_at = NOW()`,
            [req.orgId, journalist.id, s.dimensionId, s.score],
          );
        }
        const { rows: [{ total }] } = await client.query(
          `SELECT COALESCE(SUM(score), 0)::int as total FROM journalist_scores WHERE org_id = $1 AND journalist_id = $2`,
          [req.orgId, journalist.id],
        );
        await client.query('UPDATE journalists SET total_score = $1, updated_at = NOW() WHERE id = $2', [total, journalist.id]);
        await client.query('COMMIT');
        console.log(`[JournalistSuggestions] Auto-scored "${suggestion.name}" → ${total} pts`);
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('[JournalistSuggestions] Auto-score save failed:', err.message);
      } finally {
        client.release();
      }
    }).catch(err => console.error('[JournalistSuggestions] Auto-score failed:', err.message));
  }
});

router.post('/:id/reject', async (req, res) => {
  const result = await pool.query(
    `UPDATE journalist_suggestions SET status = 'rejected' WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.post('/scan/:publicationId', requireEditor, async (req, res) => {
  res.json({ message: 'RSS scan started' });
  scanPublicationRss(req.orgId!, Number(req.params.publicationId)).catch(err => console.error('[RSS scan]', err.message));
});

router.post('/staff-scan/:publicationId', requireEditor, async (req, res) => {
  const result = await scanStaffPage(req.orgId!, Number(req.params.publicationId));
  res.json(result);
});

router.post('/scan-all', requireEditor, async (req, res) => {
  res.json({ message: 'Full RSS scan started' });
  scanAllRssFeeds(req.orgId!).catch(err => console.error('[RSS scan-all]', err.message));
});

export default router;
