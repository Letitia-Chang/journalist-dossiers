import { Router } from 'express';
import pool from '../db';
import { loadProfile, emptyProfile } from '../lib/companyProfile';
import { isDemo } from '../demo/limits';
import { DEMO_PROFILE } from '../demo/seedData';

const router = Router();

/**
 * Public. Tells the client whether first-run setup is still needed and what branding to
 * show on the login/setup screens (before anyone is signed in).
 */
router.get('/status', async (_req, res) => {
  // The demo has no company of its own: each visitor gets a sandbox when they enter.
  if (isDemo()) {
    res.json({
      needsAdmin: false, needsProfile: false, demo: true,
      brand: { appName: DEMO_PROFILE.app_name, brandColor: DEMO_PROFILE.brand_color, logoUrl: DEMO_PROFILE.logo_url, companyName: DEMO_PROFILE.name },
    });
    return;
  }
  const { rows: [{ users }] } = await pool.query(
    'SELECT COUNT(*)::int AS users FROM users u JOIN organizations o ON o.id = u.org_id WHERE o.demo_expires_at IS NULL');
  const { rows: [org] } = await pool.query('SELECT id FROM organizations WHERE demo_expires_at IS NULL ORDER BY created_at ASC LIMIT 1');
  const profile = org ? await loadProfile(org.id) : null;
  const branding = profile ?? emptyProfile();

  res.json({
    needsAdmin: users === 0,
    needsProfile: !profile,
    demo: false,
    brand: {
      appName: branding.app_name,
      brandColor: branding.brand_color,
      logoUrl: branding.logo_url,
      companyName: profile?.name ?? '',
    },
  });
});

export default router;
