import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db';
import { HttpError } from '../lib/httpError';

export interface AuthTokenPayload {
  sub: string;
  orgId: string;
  role: string;
}

export type Role = 'owner' | 'admin' | 'member';

/** Called on boot, so a missing or guessable secret stops the server instead of weakening it. */
export function assertSessionSecret(): void {
  const secret = process.env.SESSION_SECRET ?? '';
  if (process.env.NODE_ENV === 'production' && (secret.length < 32 || /^change-?me/i.test(secret))) {
    throw new Error('SESSION_SECRET must be a random string of at least 32 characters (openssl rand -hex 32).');
  }
  if (!secret) throw new Error('SESSION_SECRET is not set');
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d', algorithm: 'HS256' });
}

/** A short-lived token that only proves who started the Gmail consent flow. It is not a session. */
export function signOAuthState(userId: string, orgId: string): string {
  return jwt.sign({ sub: userId, orgId }, getSecret(), { expiresIn: '10m', algorithm: 'HS256', audience: 'gmail-oauth' });
}

export function verifyOAuthState(state: string): { sub: string; orgId: string } {
  return jwt.verify(state, getSecret(), { algorithms: ['HS256'], audience: 'gmail-oauth' }) as { sub: string; orgId: string };
}

/** The user's role right now, or null if they were removed. The token only says who they were at login. */
export async function currentRole(userId: string, orgId: string): Promise<Role | null> {
  const { rows: [row] } = await pool.query('SELECT role FROM users WHERE id = $1 AND org_id = $2', [userId, orgId]);
  return row?.role ?? null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Unauthorized');

  let decoded: AuthTokenPayload & { aud?: string };
  try {
    decoded = jwt.verify(header.slice(7), getSecret(), { algorithms: ['HS256'] }) as typeof decoded;
  } catch {
    throw new HttpError(401, 'Unauthorized');
  }
  // Tokens issued for another purpose carry an audience and are never sessions.
  if (decoded.aud !== undefined) throw new HttpError(401, 'Unauthorized');

  // Looked up on every request so removing or demoting someone takes effect immediately.
  const role = await currentRole(decoded.sub, decoded.orgId);
  if (!role) throw new HttpError(401, 'Unauthorized');

  req.userId = decoded.sub;
  req.orgId = decoded.orgId;
  req.userRole = role;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole as Role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}
