import { Router } from 'express';
import bcrypt from 'bcrypt';
import type { Pool, PoolClient } from 'pg';
import pool, { inTransaction } from '../db';
import { HttpError } from '../lib/httpError';
import { signToken } from '../middleware/auth';
import { ensureOrg, seedDimensions } from '../lib/bootstrap';
import { isDemo } from '../demo/limits';
import { createSandbox, makeRoomForSandbox } from '../demo/seed';
import { blockInDemo } from '../middleware/demo';
import { clientIp } from '../lib/clientIp';
import { bucketFor, DAY_MS, giveBack, HOUR_MS, networkOf, normalizeIp, take } from '../lib/rateLimit';
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

  // Hashing is slow: do it before taking a connection, and not at all once setup is done.
  if ((await realUserCount(pool)) > 0) throw setupDone();
  const passwordHash = await bcrypt.hash(password, 12);

  const { user, org } = await inTransaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7001)'); // serialize concurrent first-run signups
    if ((await realUserCount(db)) > 0) throw setupDone();
    const orgId = await ensureOrg(db);
    await seedDimensions(orgId, undefined, db); // no-op when already seeded at boot
    const { rows: [created] } = await db.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, email, name, role`,
      [orgId, email, passwordHash, name],
    );
    const { rows: [row] } = await db.query('SELECT id, name, slug FROM organizations WHERE id = $1', [orgId]);
    return { user: created, org: row };
  });
  res.status(201).json({ token: signToken({ sub: user.id, orgId: org.id, role: user.role }), user, org });
});

const setupDone = () => new HttpError(403, 'Setup is already complete. Ask the owner for an invite.');

async function realUserCount(db: Pool | PoolClient): Promise<number> {
  const { rows: [{ c }] } = await db.query(
    'SELECT COUNT(*)::int AS c FROM users u JOIN organizations o ON o.id = u.org_id WHERE o.demo_expires_at IS NULL');
  return c;
}

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

const invalidInvite = () => new HttpError(404, 'This invite is invalid or has expired');
const OPEN_INVITE = `SELECT id, org_id, email, role FROM invites WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`;

router.post('/accept-invite', async (req, res) => {
  const { token, name, password } = parseBody(schemas.acceptInvite, req);
  if ((await pool.query(OPEN_INVITE, [token])).rowCount === 0) throw invalidInvite();
  const passwordHash = await bcrypt.hash(password, 12);

  const { user, org } = await inTransaction(async db => {
    const { rows: [invite] } = await db.query(`${OPEN_INVITE} FOR UPDATE`, [token]); // one winner
    if (!invite) throw invalidInvite();
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [invite.email]);
    if (rowCount) throw new HttpError(409, 'An account with that email already exists');
    const { rows: [created] } = await db.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, LOWER($2), $3, $4, $5) RETURNING id, email, name, role`,
      [invite.org_id, invite.email, passwordHash, name, invite.role],
    );
    await db.query(`UPDATE invites SET status = 'accepted' WHERE id = $1`, [invite.id]);
    const { rows: [row] } = await db.query('SELECT id, name, slug FROM organizations WHERE id = $1', [invite.org_id]);
    return { user: created, org: row };
  });
  res.status(201).json({ token: signToken({ sub: user.id, orgId: org.id, role: user.role }), user, org });
});

// Public demo only: give the visitor a private sandbox and sign them in to it (no password).
router.post('/demo-login', async (req, res) => {
  if (!isDemo()) return res.status(404).json({ error: 'Not found' });
  const ip = clientIp(req);
  const granted = await take([
    { bucket: bucketFor('sandbox', normalizeIp(ip)), windowMs: HOUR_MS, limit: 10 },
    { bucket: bucketFor('sandbox-net', networkOf(ip)), windowMs: HOUR_MS, limit: 20 },
    { bucket: 'sandbox-all', windowMs: HOUR_MS, limit: 200 },
  ]);
  if (granted === 0) return res.status(429).json({ error: 'The demo has been opened many times in the last hour. Please try again later.' });
  if (!(await makeRoomForSandbox())) return res.status(503).json({ error: 'The demo is full right now. Please try again in a little while.' });

  const { user, org } = await createSandbox();
  res.json({ token: signToken({ sub: user.id, orgId: org.id, role: user.role }), user, org });
});

// Hash of a discarded random value, compared against when the email is unknown so both cases take
// the same time.
const DUMMY_HASH = '$2b$12$cEbFpgHZNHwrm281DpHnm.SWkSGlhDmCyKySRSyrmC7eO04dgBEOq';

router.post('/login', async (req, res) => {
  const { email, password } = parseBody(schemas.login, req);

  // Failures are limited per account and address, per address, and (far more loosely, since this one
  // could be used to lock someone out) per account from anywhere. Behind a proxy the address is only
  // right when TRUST_PROXY / CLIENT_IP_HEADER are set; see docs/deployment.md.
  const ip = normalizeIp(clientIp(req));
  const counters = [
    { bucket: bucketFor('login', `${email}|${ip}`), windowMs: LOGIN_WINDOW_MS, limit: 10 },
    { bucket: bucketFor('login-ip', ip), windowMs: LOGIN_WINDOW_MS, limit: 50 },
    { bucket: bucketFor('login-account', email), windowMs: DAY_MS, limit: 1000 },
  ];
  // Taken up front, so parallel guesses can't slip past, and returned if the password was right.
  if ((await take(counters)) === 0) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, o.id as org_id, o.name as org_name, o.slug as org_slug
     FROM users u JOIN organizations o ON o.id = u.org_id
     WHERE LOWER(u.email) = $1 AND o.demo_expires_at IS NULL
     ORDER BY (u.email = $1) DESC LIMIT 1`,
    [email],
  );
  const row = rows[0];
  const matches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  await giveBack(counters);

  const token = signToken({ sub: row.id, orgId: row.org_id, role: row.role });
  res.json({
    token,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
    org: { id: row.org_id, name: row.org_name, slug: row.org_slug },
  });
});

export default router;
