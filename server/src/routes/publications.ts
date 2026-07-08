import { Router } from 'express';
import * as cheerio from 'cheerio';
import pool from '../db';
import { discoverRssUrl } from '../services/rssDiscovery';
import { discoverPublications } from '../services/blogDiscovery';
import { discoverAndSaveFeeds } from '../services/categoryFeedDiscovery';
import { scanAllRssFeeds } from '../services/rssService';
import { runHealthChecks, getHealthSummary } from '../services/healthCheckService';
import { requireRole } from '../middleware/auth';

const router = Router();
const requireEditor = requireRole('owner', 'admin');

function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, url, tier, focus, notes, active, rss_url, rss_status, rss_status_note,
            health_status, last_health_check, created_at, updated_at
     FROM publications WHERE org_id = $1
     ORDER BY name ASC`,
    [req.orgId],
  );
  res.json(rows);
});

// ── Discovery — must come before /:id so "discover" isn't parsed as an id ──────

router.post('/discover', requireEditor, async (req, res) => {
  const { query } = req.body as { query?: string };
  if (!query?.trim()) return res.status(400).json({ error: 'query is required' });

  const { rows: existing } = await pool.query('SELECT url FROM publications WHERE org_id = $1', [req.orgId]);
  const existingDomains = new Set(
    existing.filter(p => p.url).map(p => {
      try { return new URL(p.url.startsWith('http') ? p.url : `https://${p.url}`).hostname.replace(/^www\./, '').toLowerCase(); }
      catch { return p.url.toLowerCase(); }
    }),
  );

  const results = await discoverPublications(query.trim(), existingDomains);
  res.json(results);
});

router.post('/import-opml', requireEditor, async (req, res) => {
  const { opml } = req.body as { opml?: string };
  if (!opml?.trim()) return res.status(400).json({ error: 'opml text is required' });

  let outlines: { name: string; homepage: string; feedUrl: string }[];
  try {
    const $ = cheerio.load(opml, { xmlMode: true });
    outlines = $('outline[xmlUrl]').toArray().map(el => {
      const node = $(el);
      const xmlUrl = (node.attr('xmlUrl') ?? '').trim();
      const homepage = (node.attr('htmlUrl') ?? '').trim();
      const name = (node.attr('title') ?? '').trim() || (node.attr('text') ?? '').trim() || hostnameOf(homepage || xmlUrl);
      return { name, homepage, feedUrl: xmlUrl };
    }).filter(o => o.feedUrl);
  } catch {
    return res.status(400).json({ error: 'Could not parse OPML file' });
  }
  if (outlines.length === 0) return res.status(400).json({ error: 'No feed entries found in this OPML file' });

  const groups = new Map<string, typeof outlines>();
  for (const o of outlines) {
    const domain = hostnameOf(o.homepage || o.feedUrl);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(o);
  }

  const { rows: existingPubs } = await pool.query(
    'SELECT id, name, url, rss_url FROM publications WHERE org_id = $1', [req.orgId],
  );
  const byDomain = new Map(existingPubs.filter(p => p.url).map(p => [hostnameOf(p.url), p]));
  const byName = new Map(existingPubs.map(p => [p.name.toLowerCase(), p]));
  const mainFeedByPubId = new Map(existingPubs.map(p => [p.id, p.rss_url]));

  let added = 0, feedsAdded = 0, skipped = 0;

  for (const [domain, entries] of groups) {
    const existing = byDomain.get(domain) ?? byName.get(entries[0].name.toLowerCase());
    let pubId: number;
    if (existing) {
      pubId = existing.id;
      skipped++;
    } else {
      const first = entries[0];
      const { rows: [newPub] } = await pool.query(
        `INSERT INTO publications (org_id, name, url, rss_url) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.orgId, first.name, first.homepage || `https://${domain}`, first.feedUrl],
      );
      pubId = newPub.id;
      mainFeedByPubId.set(pubId, first.feedUrl);
      added++;
    }

    for (const entry of entries) {
      if (entry.feedUrl === mainFeedByPubId.get(pubId)) continue;
      const { rows: [dupe] } = await pool.query(
        'SELECT id FROM publication_feeds WHERE publication_id = $1 AND feed_url = $2', [pubId, entry.feedUrl],
      );
      if (dupe) continue;
      await pool.query(
        `INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
         VALUES ($1, $2, $3, $4, 'category')`,
        [req.orgId, pubId, entry.feedUrl, entry.name],
      );
      feedsAdded++;
    }
  }

  res.json({ added, feedsAdded, skipped });
});

router.post('/check-feeds', requireEditor, async (req, res) => {
  res.json({ message: 'Health check started — statuses will update in 1–2 minutes.' });
  runHealthChecks(req.orgId!).catch(err => console.error('[HealthCheck]', err.message));
});

router.post('/sync-feeds', requireEditor, async (req, res) => {
  res.json({ message: 'Syncing feeds — discovery then verification. This may take a few minutes.' });
  (async () => {
    const { rows: pubs } = await pool.query(
      `SELECT id FROM publications WHERE org_id = $1 AND active = true`, [req.orgId],
    );
    for (const pub of pubs) {
      await discoverAndSaveFeeds(req.orgId!, pub.id).catch(err => console.error('[SyncFeeds] discover', err.message));
    }
    await scanAllRssFeeds(req.orgId!).catch(err => console.error('[SyncFeeds] scan', err.message));
  })();
});

router.get('/health-summary', async (req, res) => {
  const summary = await getHealthSummary(req.orgId!);
  res.json(summary);
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT id, name, url, tier, focus, notes, active, rss_url, rss_status, rss_status_note,
            health_status, last_health_check, created_at, updated_at
     FROM publications WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/:id/journalists', async (req, res) => {
  const { rows: [pub] } = await pool.query(
    'SELECT id FROM publications WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!pub) return res.status(404).json({ error: 'Not found' });

  const { rows } = await pool.query(
    `SELECT j.id, j.name, j.email, j.twitter, j.linkedin, j.beats, j.total_score, j.is_favorite,
            COALESCE((SELECT ol.status FROM outreach_logs ol WHERE ol.journalist_id = j.id AND ol.org_id = j.org_id
              ORDER BY ol.logged_at DESC LIMIT 1), 'Not Started') as outreach_status
     FROM journalists j
     WHERE j.publication_id = $1 AND j.org_id = $2
     ORDER BY j.total_score DESC, j.name ASC`,
    [req.params.id, req.orgId],
  );
  res.json(rows);
});

router.get('/:id/feeds', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, feed_url, feed_label, feed_type, rss_status, rss_last_checked, created_at
     FROM publication_feeds WHERE publication_id = $1 AND org_id = $2 ORDER BY created_at ASC`,
    [req.params.id, req.orgId],
  );
  res.json(rows);
});

router.post('/:id/feeds', requireEditor, async (req, res) => {
  const { feedUrl, feedLabel } = req.body as { feedUrl?: string; feedLabel?: string };
  if (!feedUrl) return res.status(400).json({ error: 'feedUrl is required' });

  const { rows: [pub] } = await pool.query('SELECT id FROM publications WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!pub) return res.status(404).json({ error: 'Publication not found' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
     VALUES ($1, $2, $3, $4, 'category')
     RETURNING id, feed_url, feed_label, feed_type, rss_status, rss_last_checked, created_at`,
    [req.orgId, req.params.id, feedUrl, feedLabel ?? 'Category'],
  );
  res.status(201).json(row);
});

router.delete('/:id/feeds/:feedId', requireEditor, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM publication_feeds WHERE id = $1 AND publication_id = $2 AND org_id = $3',
    [req.params.feedId, req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

router.post('/:id/discover-rss', requireEditor, async (req, res) => {
  const { rows: [pub] } = await pool.query('SELECT id, url FROM publications WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!pub) return res.status(404).json({ error: 'Not found' });
  if (!pub.url) return res.status(400).json({ error: 'Publication has no homepage URL' });

  const feedUrl = await discoverRssUrl(pub.url);
  if (!feedUrl) return res.status(404).json({ error: 'No RSS feed found' });

  await pool.query(`UPDATE publications SET rss_url = $1, rss_status = 'active', rss_last_checked = NOW() WHERE id = $2`, [feedUrl, req.params.id]);
  res.json({ feedUrl });
});

router.post('/:id/discover-feeds', requireEditor, async (req, res) => {
  res.json({ message: 'Discovering category feeds — this runs in the background (~20s).' });
  discoverAndSaveFeeds(req.orgId!, Number(req.params.id)).catch(err => console.error('[DiscoverFeeds]', err.message));
});

router.post('/', requireEditor, async (req, res) => {
  const { name, url, tier, focus, notes, rssUrl } = req.body as {
    name?: string; url?: string; tier?: string; focus?: string; notes?: string; rssUrl?: string;
  };
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO publications (org_id, name, url, tier, focus, notes, rss_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, url, tier, focus, notes, active, rss_url, rss_status, rss_status_note,
               health_status, last_health_check, created_at, updated_at`,
    [req.orgId, name, url ?? '', tier ?? 'B', focus ?? '', notes ?? '', rssUrl ?? ''],
  );
  res.status(201).json(row);
});

router.put('/:id', requireEditor, async (req, res) => {
  const { name, url, tier, focus, notes, active, rssUrl } = req.body as {
    name?: string; url?: string; tier?: string; focus?: string; notes?: string; active?: boolean; rssUrl?: string;
  };
  const { rows: [row] } = await pool.query(
    `UPDATE publications SET
       name = COALESCE($1, name),
       url = COALESCE($2, url),
       tier = COALESCE($3, tier),
       focus = COALESCE($4, focus),
       notes = COALESCE($5, notes),
       active = COALESCE($6, active),
       rss_url = COALESCE($7, rss_url),
       updated_at = NOW()
     WHERE id = $8 AND org_id = $9
     RETURNING id, name, url, tier, focus, notes, active, rss_url, rss_status, rss_status_note,
               health_status, last_health_check, created_at, updated_at`,
    [name, url, tier, focus, notes, active, rssUrl, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', requireEditor, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM publications WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
