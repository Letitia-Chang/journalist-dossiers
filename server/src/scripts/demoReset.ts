/** Restore the demo seed data: `npm run demo:reset` (requires DEMO_MODE=true). */
import 'dotenv/config';
import pool from '../db';
import { resetAndSeedDemo } from '../demo/seed';

(async () => {
  if (process.env.DEMO_MODE !== 'true') {
    console.error('Refusing to run: set DEMO_MODE=true to reset the demo data.');
    process.exit(1);
  }
  await resetAndSeedDemo();
  console.log('Demo data reset.');
  await pool.end();
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
