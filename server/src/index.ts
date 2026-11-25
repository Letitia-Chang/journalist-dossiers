import 'dotenv/config';
import { app } from './app';
import { bootstrap } from './lib/bootstrap';
import { assertSessionSecret } from './middleware/auth';
import { sweepSandboxes } from './demo/seed';
import { HOUR_MS, pruneRateLimits } from './lib/rateLimit';

// Express 5 handles rejected route handlers; this is the backstop for background work.
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

assertSessionSecret();

bootstrap()
  .then(() => {
    if (process.env.DEMO_MODE === 'true') {
      setInterval(() => { sweepSandboxes().catch(err => console.error('[demo] sweep failed:', err.message)); }, HOUR_MS).unref();
    }
    setInterval(() => { pruneRateLimits().catch(err => console.error('[rate-limits] prune failed:', err.message)); }, HOUR_MS).unref();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[bootstrap] failed:', err.message);
    process.exit(1);
  });
