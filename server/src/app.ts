import express from 'express';
import cors from 'cors';
import userAuthRouter from './routes/userAuth';
import scoringDimensionsRouter from './routes/scoringDimensions';
import publicationsRouter from './routes/publications';
import journalistsRouter from './routes/journalists';
import outreachRouter from './routes/outreach';
import articlesRouter from './routes/articles';
import campaignsRouter from './routes/campaigns';
import campaignStylesRouter from './routes/campaignStyles';
import coverageRouter from './routes/coverage';
import dashboardRouter from './routes/dashboard';
import exportRouter from './routes/export';
import journalistSuggestionsRouter from './routes/journalistSuggestions';
import suggestionsRouter from './routes/suggestions';
import teamRouter from './routes/team';
import googleAuthRouter from './routes/googleAuth';
import setupRouter from './routes/setup';
import companyRouter from './routes/company';
import { requireAuth } from './middleware/auth';
import { allowedOrigins, isOriginAllowed } from './lib/cors';

export const app = express();

// Behind a proxy (Render, Vercel, etc.) req.ip is the proxy unless we trust X-Forwarded-For.
if (process.env.DEMO_MODE === 'true' || process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const origins = allowedOrigins();

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, origins)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ── Auth — signup/login must come before requireAuth ─────────────────────────
app.use('/api/auth', userAuthRouter);
app.use('/api/setup', setupRouter);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Gmail OAuth — mounted at the bare /auth path (not /api) since /auth/google and
// /auth/google/callback are plain browser redirects that can't carry an
// Authorization header. Auth for those two routes is handled via a signed JWT
// passed as a query param instead; /auth/gmail/status and /auth/gmail (delete)
// apply requireAuth internally since those are normal XHR calls.
app.use('/auth', googleAuthRouter);

app.use('/api', requireAuth);

// ── Org-scoped resource routes ────────────────────────────────────────────────
app.use('/api/scoring-dimensions', scoringDimensionsRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api/journalists', journalistsRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/campaign-styles', campaignStylesRouter);
app.use('/api/coverage', coverageRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/export', exportRouter);
app.use('/api/journalist-suggestions', journalistSuggestionsRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/team', teamRouter);
app.use('/api/company', companyRouter);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});
