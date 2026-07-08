import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { requireRole } from '../middleware/auth';

const router = Router();
const requireOwner = requireRole('owner');

function inviteLink(token: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${base}/accept-invite/${token}`;
}

router.get('/members', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, created_at FROM users WHERE org_id = $1 ORDER BY created_at ASC`,
    [req.orgId],
  );
  res.json(rows);
});

router.put('/members/:id/role', requireOwner, async (req, res) => {
  const { role } = req.body as { role?: string };
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be owner, admin, or member' });
  }

  const { rows: [target] } = await pool.query(
    'SELECT id, role FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId],
  );
  if (!target) return res.status(404).json({ error: 'Not found' });

  if (target.role === 'owner' && role !== 'owner') {
    const { rows: [{ c }] } = await pool.query(
      `SELECT COUNT(*)::int as c FROM users WHERE org_id = $1 AND role = 'owner'`, [req.orgId],
    );
    if (c <= 1) return res.status(400).json({ error: 'Cannot change role — this is the last owner' });
  }

  const { rows: [row] } = await pool.query(
    `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3
     RETURNING id, name, email, role, created_at`,
    [role, req.params.id, req.orgId],
  );
  res.json(row);
});

router.delete('/members/:id', requireOwner, async (req, res) => {
  const { rows: [target] } = await pool.query(
    'SELECT id, role FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId],
  );
  if (!target) return res.status(404).json({ error: 'Not found' });

  if (target.role === 'owner') {
    const { rows: [{ c }] } = await pool.query(
      `SELECT COUNT(*)::int as c FROM users WHERE org_id = $1 AND role = 'owner'`, [req.orgId],
    );
    if (c <= 1) return res.status(400).json({ error: 'Cannot remove the last owner' });
  }

  await pool.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  res.status(204).end();
});

router.get('/invites', requireOwner, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, role, status, expires_at, created_at, token FROM invites
     WHERE org_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [req.orgId],
  );
  res.json(rows.map(({ token, ...r }) => ({ ...r, link: inviteLink(token) })));
});

router.post('/invites', requireOwner, async (req, res) => {
  const { email, role } = req.body as { email?: string; role?: string };
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const finalRole = role && ['owner', 'admin', 'member'].includes(role) ? role : 'member';

  const { rows: [existingUser] } = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existingUser) return res.status(409).json({ error: 'A user with that email already exists' });

  // Replace any prior pending invite for the same email in this org
  await pool.query(
    `UPDATE invites SET status = 'revoked' WHERE org_id = $1 AND email = $2 AND status = 'pending'`,
    [req.orgId, normalizedEmail],
  );

  const token = crypto.randomBytes(24).toString('hex');
  const { rows: [invite] } = await pool.query(
    `INSERT INTO invites (org_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
     RETURNING id, email, role, status, expires_at, created_at, token`,
    [req.orgId, normalizedEmail, finalRole, token, req.userId],
  );
  res.status(201).json({ ...invite, link: inviteLink(invite.token) });
});

router.delete('/invites/:id', requireOwner, async (req, res) => {
  const result = await pool.query(
    `UPDATE invites SET status = 'revoked' WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
