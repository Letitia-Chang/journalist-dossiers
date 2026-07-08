import 'dotenv/config';
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
import { requireAuth } from './middleware/auth';

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

// ── Auth — signup/login must come before requireAuth ─────────────────────────
app.use('/api/auth', userAuthRouter);
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

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
