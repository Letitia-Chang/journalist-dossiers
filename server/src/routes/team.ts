import { Router } from 'express';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import pool, { inTransaction } from '../db';
import { HttpError } from '../lib/httpError';
import { requireRole } from '../middleware/auth';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const router = Router();
validateParams(router, { id: 'uuid' });
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

/** Lock the owners, then refuse a change that would leave none. Two owners can't demote each other. */
async function assertNotLastOwner(db: PoolClient, orgId: string, userId: unknown, message: string): Promise<void> {
  const { rows: owners } = await db.query(`SELECT id = $2::uuid AS is_target FROM users WHERE org_id = $1 AND role = 'owner' ORDER BY id FOR UPDATE`, [orgId, userId]);
  if (owners.length <= 1 && owners[0]?.is_target) throw new HttpError(400, message);
}

/** Invites someone sent, or that were sent to them, must not outlive their access. */
async function revokeInvitesOf(db: PoolClient, orgId: string, userId: unknown): Promise<void> {
  await db.query(
    `UPDATE invites SET status = 'revoked' WHERE org_id = $1 AND status = 'pending'
       AND (invited_by = $2 OR LOWER(email) = (SELECT LOWER(email) FROM users WHERE id = $2))`,
    [orgId, userId],
  );
}

router.put('/members/:id/role', requireOwner, async (req, res) => {
  const { role } = parseBody(schemas.roleUpdate, req);
  const row = await inTransaction(async db => {
    if (role !== 'owner') {
      await assertNotLastOwner(db, req.orgId!, req.params.id, 'Cannot change role — this is the last owner');
      await revokeInvitesOf(db, req.orgId!, req.params.id);
    }
    const { rows: [updated] } = await db.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3
       RETURNING id, name, email, role, created_at`,
      [role, req.params.id, req.orgId],
    );
    if (!updated) throw new HttpError(404, 'Not found');
    return updated;
  });
  res.json(row);
});

router.delete('/members/:id', requireOwner, async (req, res) => {
  await inTransaction(async db => {
    await assertNotLastOwner(db, req.orgId!, req.params.id, 'Cannot remove the last owner');
    await revokeInvitesOf(db, req.orgId!, req.params.id);
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
    if (!rowCount) throw new HttpError(404, 'Not found');
  });
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
  const { email, role } = parseBody(schemas.invite, req);

  const { rowCount: exists } = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email]);
  if (exists) return res.status(409).json({ error: 'A user with that email already exists' });

  const token = crypto.randomBytes(24).toString('hex');
  const invite = await inTransaction(async db => {
    // Replace any open invite for the same email; a unique index keeps it to one.
    await db.query(`UPDATE invites SET status = 'revoked' WHERE org_id = $1 AND email = $2 AND status = 'pending'`, [req.orgId, email]);
    const { rows: [created] } = await db.query(
      `INSERT INTO invites (org_id, email, role, token, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
       RETURNING id, email, role, status, expires_at, created_at, token`,
      [req.orgId, email, role, token, req.userId],
    );
    return created;
  });
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
