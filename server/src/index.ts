import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool, { initDb } from './db';
import journalistsRouter from './routes/journalists';
import articlesRouter from './routes/articles';
import outreachRouter from './routes/outreach';
import exportRouter from './routes/export';
import publicationsRouter from './routes/publications';
import suggestionsRouter from './routes/suggestions';
import journalistSuggestionsRouter from './routes/journalistSuggestions';
import { startSuggestionCron, runSuggestionJob } from './cron/suggestionJob';
import { startRssCron } from './cron/rssJob';
import { scanAllRssFeeds } from './services/rssService';
import { discoverAndSaveFeeds } from './services/categoryFeedDiscovery';
import { startHealthCheckCron, runHealthChecks } from './cron/healthCheckJob';
import { refreshAllJournalistArticles } from './services/refreshJournalistArticles';
import campaignsRouter from './routes/campaigns';
import enrichmentRouter from './routes/enrichment';
import campaignStylesRouter from './routes/campaignStyles';
import coverageRouter from './routes/coverage';
import usersRouter from './routes/users';
import authRouter from './routes/auth';
import cron from 'node-cron';
import { requireAuth, loginHandler } from './middleware/auth';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin === allowed || origin.endsWith('.netlify.app'))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ── Auth — login + health must come before requireAuth middleware ──────────────
app.post('/api/auth/login', loginHandler);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', requireAuth);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/journalists', journalistsRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/export', exportRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/journalist-suggestions', journalistSuggestionsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/enrichment', enrichmentRouter);
app.use('/api/campaign-styles', campaignStylesRouter);
app.use('/api/coverage', coverageRouter);
app.use('/api/users', usersRouter);
app.use('/auth', authRouter);

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (_req, res) => {
  try {
    const [
      totalRes, avgRes, followUpsRes, recentOutreachRes,
      staleRes, unreachableRes, overdueFollowUpsRes, needsReSearchRes,
      activeCampaignsRes, draftsReadyRes, sentRes, sentLastWeekRes,
      recentCampaignsRes, approvedWaitingRes, warmContactsRes, recentCoverageRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as c FROM journalists'),
      pool.query('SELECT AVG("totalScore")::numeric(6,1) as avg FROM journalists'),
      pool.query(`
        SELECT * FROM journalists
        WHERE "nextFollowUpDate" IS NOT NULL AND "nextFollowUpDate" != ''
          AND "nextFollowUpDate"::DATE <= CURRENT_DATE + INTERVAL '7 days'
        ORDER BY "nextFollowUpDate" ASC LIMIT 10
      `),
      pool.query(`
        SELECT ol.*, j.name as "journalistName", j.publication
        FROM outreach_logs ol
        JOIN journalists j ON j.id = ol."journalistId"
        ORDER BY ol."createdAt" DESC LIMIT 10
      `),
      pool.query('SELECT COUNT(*)::int as c FROM journalists WHERE "staleFlag" = 1'),
      pool.query("SELECT COUNT(*)::int as c FROM publications WHERE \"healthStatus\" = 'unreachable'"),
      pool.query(`
        SELECT COUNT(*)::int as c FROM journalists
        WHERE "outreachStatus" IN ('Pitched','Responded')
          AND "nextFollowUpDate" IS NOT NULL AND "nextFollowUpDate" != ''
          AND "nextFollowUpDate"::DATE < CURRENT_DATE
      `),
      pool.query(`
        SELECT COUNT(*)::int as c FROM journalists
        WHERE "serpSearchedAt" IS NOT NULL
          AND "serpSearchedAt" < NOW() - INTERVAL '90 days'
      `),
      pool.query("SELECT COUNT(*)::int as c FROM campaigns WHERE status NOT IN ('completed','archived')"),
      pool.query("SELECT COUNT(*)::int as c FROM campaign_journalists WHERE \"draftStatus\" IN ('ready','approved')"),
      pool.query(`
        SELECT COUNT(*)::int as c FROM campaign_journalists
        WHERE "draftStatus" = 'sent' AND "sentAt" != '' AND "sentAt"::DATE >= CURRENT_DATE - INTERVAL '7 days'
      `),
      // sent last week (7–14 days ago) for velocity comparison
      pool.query(`
        SELECT COUNT(*)::int as c FROM campaign_journalists
        WHERE "draftStatus" = 'sent' AND "sentAt" != ''
          AND "sentAt"::DATE >= CURRENT_DATE - INTERVAL '14 days'
          AND "sentAt"::DATE < CURRENT_DATE - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT c.id, c.name, c.type, c.status,
          COUNT(cj.id)::int as "journalistCount",
          SUM(CASE WHEN cj."draftStatus" = 'sent' THEN 1 ELSE 0 END)::int as "sentCount",
          SUM(CASE WHEN cj."draftStatus" IN ('ready','approved') THEN 1 ELSE 0 END)::int as "readyCount",
          SUM(CASE WHEN cj."draftStatus" = 'approved' THEN 1 ELSE 0 END)::int as "approvedCount",
          (SELECT COUNT(*)::int FROM coverage cv WHERE cv."campaignId" = c.id) as "coverageCount"
        FROM campaigns c
        LEFT JOIN campaign_journalists cj ON cj."campaignId" = c.id
        GROUP BY c.id
        ORDER BY c."updatedAt" DESC LIMIT 5
      `),
      // approved drafts waiting to be sent
      pool.query("SELECT COUNT(*)::int as c FROM campaign_journalists WHERE \"draftStatus\" = 'approved'"),
      // warm contacts: responded, in conversation, or covered
      pool.query(`
        SELECT id, name, publication, "outreachStatus", "totalScore", "lastContactedDate"
        FROM journalists
        WHERE "outreachStatus" IN ('Responded','In Conversation','Covered')
        ORDER BY
          CASE "outreachStatus" WHEN 'Covered' THEN 1 WHEN 'In Conversation' THEN 2 ELSE 3 END,
          "lastContactedDate" DESC NULLS LAST
        LIMIT 6
      `),
      // recent press coverage
      pool.query(`
        SELECT id, title, url, publication, "publishDate", "coverageType", sentiment
        FROM coverage
        ORDER BY "publishDate" DESC NULLS LAST, "createdAt" DESC
        LIMIT 4
      `),
    ]);

    res.json({
      total: totalRes.rows[0].c,
      avgScore: avgRes.rows[0].avg ? Math.round(Number(avgRes.rows[0].avg)) : 0,
      followUps: followUpsRes.rows,
      recentOutreach: recentOutreachRes.rows,
      staleJournalists: staleRes.rows[0].c,
      unreachablePubs: unreachableRes.rows[0].c,
      overdueFollowUps: overdueFollowUpsRes.rows[0].c,
      needsReSearch: needsReSearchRes.rows[0].c,
      activeCampaigns: activeCampaignsRes.rows[0].c,
      draftsReady: draftsReadyRes.rows[0].c,
      approvedWaiting: approvedWaitingRes.rows[0].c,
      sentThisWeek: sentRes.rows[0].c,
      sentLastWeek: sentLastWeekRes.rows[0].c,
      recentCampaigns: recentCampaignsRes.rows,
      warmContacts: warmContactsRes.rows,
      recentCoverage: recentCoverageRes.rows,
    });
  } catch (err: any) {
    console.error('[Dashboard]', err.message);
    res.status(500).json({ error: 'Dashboard query failed' });
  }
});




// ── Manual triggers (admin use) ───────────────────────────────────────────────
app.post('/api/suggestions/run-now', async (_req, res) => {
  res.json({ message: 'Suggestion job started' });
  runSuggestionJob().catch(console.error);
});

app.post('/api/publications/check-feeds', async (_req, res) => {
  res.json({ message: 'Feed check started — statuses will update in 1–2 minutes.' });
  scanAllRssFeeds().catch(console.error);
});

app.post('/api/publications/discover-feeds-all', async (_req, res) => {
  const pubs = (await pool.query(
    `SELECT id, name FROM publications WHERE active = 1 AND "isVirtual" = 0`
  )).rows;
  res.json({ message: `Discovering feeds for ${pubs.length} publications — this runs in the background.` });
  (async () => {
    for (const pub of pubs) {
      await discoverAndSaveFeeds(pub.id).catch(err =>
        console.error(`[FeedDiscovery] Failed for "${pub.name}":`, err.message)
      );
    }
    console.log('[FeedDiscovery] Bulk discovery complete');
  })();
});

// Sync feeds: discover new feed URLs for all pubs, then verify all feeds — runs sequentially in background
app.post('/api/publications/sync-feeds', async (_req, res) => {
  const pubs = (await pool.query(
    `SELECT id, name FROM publications WHERE active = 1 AND "isVirtual" = 0`
  )).rows;
  res.json({ message: `Syncing feeds for ${pubs.length} publications — discovery then verification. This may take several minutes.` });
  (async () => {
    console.log(`[SyncFeeds] Step 1/2: Discovering feeds for ${pubs.length} publications...`);
    for (const pub of pubs) {
      await discoverAndSaveFeeds(pub.id).catch(err =>
        console.error(`[SyncFeeds] Discovery failed for "${pub.name}":`, err.message)
      );
    }
    console.log('[SyncFeeds] Step 2/2: Verifying all feeds...');
    await scanAllRssFeeds().catch(err =>
      console.error('[SyncFeeds] Verification failed:', err.message)
    );
    console.log('[SyncFeeds] Complete.');
  })();
});

app.post('/api/health-check/run-now', async (_req, res) => {
  res.json({ message: 'Health check started' });
  runHealthChecks().catch(console.error);
});

app.get('/api/health-check/summary', async (_req, res) => {
  try {
    const [unreachable, stale, inactiveFeeds] = await Promise.all([
      pool.query("SELECT id, name, url, \"lastHealthCheck\" FROM publications WHERE \"healthStatus\" = 'unreachable'"),
      pool.query("SELECT id, name, publication, \"updatedAt\" FROM journalists WHERE \"staleFlag\" = 1 ORDER BY \"updatedAt\" ASC LIMIT 20"),
      pool.query("SELECT id, name, \"rssUrl\", \"rssLastChecked\" FROM publications WHERE \"rssStatus\" = 'inactive' AND active = 1"),
    ]);
    res.json({ unreachable: unreachable.rows, stale: stale.rows, inactiveFeeds: inactiveFeeds.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/journalist-articles/refresh-now', async (_req, res) => {
  res.json({ message: 'Article refresh started — check server logs for progress.' });
  refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startSuggestionCron();
      startRssCron();
      startHealthCheckCron();

      // Mondays 6am ET — refresh articles for all tracked journalists (same day as other jobs)
      cron.schedule('0 6 * * 1', () => {
        console.log('[ArticleRefresh] Weekly journalist article refresh starting...');
        refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
      }, { timezone: 'America/New_York' });
      console.log('[ArticleRefresh] Weekly article refresh cron scheduled — Mondays at 6am ET');
    });
  })
  .catch(err => {
    console.error('[DB] Failed to initialise database:', err);
    process.exit(1);
  });
