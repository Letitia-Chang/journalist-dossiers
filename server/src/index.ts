import 'dotenv/config';
import { app } from './app';
import { bootstrap } from './lib/bootstrap';
import { resetAndSeedDemo } from './demo/seed';

// Express 5 handles rejected route handlers; this is the backstop for background work.
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

bootstrap()
  .then(() => {
    // The demo restores its seed data periodically so visitors can't permanently trash it.
    if (process.env.DEMO_MODE === 'true') {
      const hours = Number(process.env.DEMO_RESET_HOURS ?? 6);
      if (hours > 0) {
        setInterval(() => {
          resetAndSeedDemo().catch(err => console.error('[demo] reseed failed:', err.message));
        }, hours * 60 * 60 * 1000).unref();
      }
    }
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[bootstrap] failed:', err.message);
    process.exit(1);
  });
