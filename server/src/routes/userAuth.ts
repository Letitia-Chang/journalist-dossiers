import { Router } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db';
import { signToken } from '../middleware/auth';
import { ensureOrg, seedDimensions } from '../lib/bootstrap';
import { DEMO_USER_EMAIL } from '../demo/seedData';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const router = Router();
validateParams(router, { token: 'token' });

// First-run only: the first account becomes the owner of the single company.
// After that, people join via an invite from the owner (see /api/team/invites).
router.post('/signup', async (req, res) => {
  const { email, password, name } = parseBody(schemas.signup, req);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7001)'); // serialize concurrent first-run signups
    const { rows: [{ c }] } = await client.query('SELECT COUNT(*)::int AS c FROM users');
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

// Public demo only: sign the visitor in as the seeded member account (no password).
router.post('/demo-login', async (_req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ error: 'Not found' });
  const { rows: [row] } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, o.id AS org_id, o.name AS org_name, o.slug AS org_slug
     FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
    [DEMO_USER_EMAIL],
  );
  if (!row) return res.status(503).json({ error: 'Demo is still starting up. Try again in a moment.' });
  const token = signToken({ sub: row.id, orgId: row.org_id, role: row.role });
  res.json({
    token,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
    org: { id: row.org_id, name: row.org_name, slug: row.org_slug },
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = parseBody(schemas.login, req);
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, o.id as org_id, o.name as org_name, o.slug as org_slug
     FROM users u JOIN organizations o ON o.id = u.org_id
     WHERE u.email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
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
