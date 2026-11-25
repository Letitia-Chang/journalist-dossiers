import { Router } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db';
import { signToken } from '../middleware/auth';
import { ensureOrg, seedDimensions } from '../lib/bootstrap';
import { isDemo } from '../demo/limits';
import { createSandbox, sweepSandboxes } from '../demo/seed';
import { blockInDemo } from '../middleware/demo';
import { clientIp } from '../lib/clientIp';
import { bucketFor, HOUR_MS, normalizeIp, take } from '../lib/rateLimit';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const router = Router();
// The demo has no accounts. Without this, the first visitor could sign up as its owner.
router.use(['/signup', '/login', '/accept-invite'], blockInDemo);
validateParams(router, { token: 'token' });

// First-run only: the first account becomes the owner of the single company.
// After that, people join via an invite from the owner (see /api/team/invites).
router.post('/signup', async (req, res) => {
  const { email, password, name } = parseBody(schemas.signup, req);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7001)'); // serialize concurrent first-run signups
    const { rows: [{ c }] } = await client.query('SELECT COUNT(*)::int AS c FROM users u JOIN organizations o ON o.id = u.org_id WHERE o.demo_expires_at IS NULL');
    if (c > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Setup is already complete. Ask the owner for an invite.' });
    }

    const orgId = await ensureOrg();
    await seedDimensions(orgId); // no-op when already seeded at boot
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, email, name, role`,
      [orgId, email, passwordHash, name],
    );
    const { rows: [org] } = await client.query('SELECT id, name, slug FROM organizations WHERE id = $1', [orgId]);
    await client.query('COMMIT');

    const token = signToken({ sub: user.id, orgId: org.id, role: user.role });
    res.status(201).json({ token, user, org });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.get('/invite/:token', async (req, res) => {
  const { rows: [invite] } = await pool.query(
    `SELECT i.email, i.role, i.status, i.expires_at, o.name as org_name
     FROM invites i JOIN organizations o ON o.id = i.org_id
     WHERE i.token = $1`,
    [req.params.token],
  );
  if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
    return res.status(404).json({ error: 'This invite is invalid or has expired' });
  }
  res.json({ email: invite.email, role: invite.role, orgName: invite.org_name });
});

router.post('/accept-invite', async (req, res) => {
  const { token, name, password } = parseBody(schemas.acceptInvite, req);
  const client = await pool.connect();
  try {
    const { rows: [invite] } = await client.query('SELECT * FROM invites WHERE token = $1', [token]);
    if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(404).json({ error: 'This invite is invalid or has expired' });
    }

    const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [invite.email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');
    const { rows: [user] } = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role`,
      [invite.org_id, invite.email, passwordHash, name, invite.role],
    );
    await client.query(`UPDATE invites SET status = 'accepted' WHERE id = $1`, [invite.id]);
    const { rows: [org] } = await client.query(
      'SELECT id, name, slug FROM organizations WHERE id = $1',
      [invite.org_id],
    );
    await client.query('COMMIT');

    const jwtToken = signToken({ sub: user.id, orgId: org.id, role: user.role });
    res.status(201).json({ token: jwtToken, user, org });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Public demo only: give the visitor a private sandbox and sign them in to it (no password).
router.post('/demo-login', async (req, res) => {
  if (!isDemo()) return res.status(404).json({ error: 'Not found' });
  const granted = await take([{ bucket: bucketFor('sandbox', normalizeIp(clientIp(req))), windowMs: HOUR_MS, limit: 10 }]);
  if (granted === 0) return res.status(429).json({ error: 'You have opened the demo many times in the last hour. Please try again later.' });

  const { user, org } = await createSandbox();
  await sweepSandboxes();
  res.json({ token: signToken({ sub: user.id, orgId: org.id, role: user.role }), user, org });
});

// Hash of a discarded random value, compared against when the email is unknown so both cases take
// the same time.
const DUMMY_HASH = '$2b$12$cEbFpgHZNHwrm281DpHnm.SWkSGlhDmCyKySRSyrmC7eO04dgBEOq';

router.post('/login', async (req, res) => {
  const { email, password } = parseBody(schemas.login, req);

  // Per account *and* address, so a stranger can't lock the owner out, plus a wider limit per address.
  const ip = normalizeIp(clientIp(req));
  const granted = await take([
    { bucket: bucketFor('login', `${email}|${ip}`), windowMs: LOGIN_WINDOW_MS, limit: 10 },
    { bucket: bucketFor('login-ip', ip), windowMs: LOGIN_WINDOW_MS, limit: 50 },
  ]);
  if (granted === 0) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, o.id as org_id, o.name as org_name, o.slug as org_slug
     FROM users u JOIN organizations o ON o.id = u.org_id
     WHERE LOWER(u.email) = $1`,
    [email],
  );
  const row = rows[0];
  const matches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken({ sub: row.id, orgId: row.org_id, role: row.role });
  res.json({
    token,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
    org: { id: row.org_id, name: row.org_name, slug: row.org_slug },
  });
});

export default router;
