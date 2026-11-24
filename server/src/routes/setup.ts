import { Router } from 'express';
import pool from '../db';
import { loadProfile, emptyProfile } from '../lib/companyProfile';

const router = Router();

/**
 * Public. Tells the client whether first-run setup is still needed and what branding to
 * show on the login/setup screens (before anyone is signed in).
 */
router.get('/status', async (_req, res) => {
  const { rows: [{ users }] } = await pool.query('SELECT COUNT(*)::int AS users FROM users');
  const { rows: [org] } = await pool.query('SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1');
  const profile = org ? await loadProfile(org.id) : null;
  const branding = profile ?? emptyProfile();

  res.json({
    needsAdmin: users === 0,
    needsProfile: !profile,
    demo: process.env.DEMO_MODE === 'true',
    brand: {
      appName: branding.app_name,
      brandColor: branding.brand_color,
      logoUrl: branding.logo_url,
      companyName: profile?.name ?? '',
    },
  });
});

export default router;
