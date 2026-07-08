import { Router } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db';
import { signToken } from '../middleware/auth';

const router = Router();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'org';
}

router.post('/signup', async (req, res) => {
  const { orgName, email, password, name, companyDescription, targetVerticals } = req.body as {
    orgName?: string;
    email?: string;
    password?: string;
    name?: string;
    companyDescription?: string;
    targetVerticals?: string[];
  };

  if (!orgName || !email || !password || !name) {
    return res.status(400).json({ error: 'orgName, email, password, and name are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const baseSlug = slugify(orgName);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { rows } = await client.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (rows.length === 0) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, slug, company_description, target_verticals)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, company_description, target_verticals, tier_thresholds`,
      [orgName, slug, companyDescription ?? '', targetVerticals ?? []],
    );
    const { rows: [user] } = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'owner')
       RETURNING id, email, name, role`,
      [org.id, email, passwordHash, name],
    );
    await client.query('COMMIT');

    const token = signToken({ sub: user.id, orgId: org.id, role: user.role });
    res.status(201).json({ token, user, org });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth] signup failed', err);
    res.status(500).json({ error: 'Signup failed' });
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
  const { token, name, password } = req.body as { token?: string; name?: string; password?: string };
  if (!token || !name || !password) {
    return res.status(400).json({ error: 'token, name, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

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
      'SELECT id, name, slug, company_description, target_verticals FROM organizations WHERE id = $1',
      [invite.org_id],
    );
    await client.query('COMMIT');

    const jwtToken = signToken({ sub: user.id, orgId: org.id, role: user.role });
    res.status(201).json({ token: jwtToken, user, org });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth] accept-invite failed', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
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
  } catch (err) {
    console.error('[auth] login failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
