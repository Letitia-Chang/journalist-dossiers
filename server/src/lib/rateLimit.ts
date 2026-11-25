import { createHmac } from 'crypto';
import { isIPv6 } from 'net';
import pool from '../db';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface Counter { bucket: string; windowMs: number; limit: number }

/** One home connection owns a whole IPv6 /64, so every address in it is the same visitor. */
export function normalizeIp(ip: string): string {
  const addr = ip.replace(/%.*$/, '').toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return mapped[1];
  if (!isIPv6(addr)) return addr;
  const [head, tail] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

/** A bucket name for an identifier such as an IP or email, without storing the identifier. */
export function bucketFor(kind: string, id: string): string {
  return `${kind}:${createHmac('sha256', process.env.SESSION_SECRET ?? '').update(id).digest('hex').slice(0, 32)}`;
}

const windowStart = (c: Counter, now: number) => new Date(now - (now % c.windowMs));

/**
 * Atomically take up to `want` units from every counter at once, returning how many were granted.
 * Row locks are taken in bucket order, so concurrent callers queue instead of deadlocking.
 */
export async function take(counters: Counter[], want = 1, now = Date.now()): Promise<number> {
  const sorted = [...counters].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let granted = want;
    for (const c of sorted) {
      const { rows: [row] } = await client.query(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, $2, 0)
         ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count
         RETURNING count`,
        [c.bucket, windowStart(c, now)],
      );
      granted = Math.max(0, Math.min(granted, c.limit - row.count));
    }
    if (granted > 0) {
      for (const c of sorted) {
        await client.query('UPDATE rate_limits SET count = count + $3 WHERE bucket = $1 AND window_start = $2', [c.bucket, windowStart(c, now), granted]);
      }
    }
    await client.query('COMMIT');
    return granted;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err; // fail closed: no counter, no spend
  } finally {
    client.release();
  }
}

/** How many units each counter has left, without taking any. */
export async function remaining(counters: Counter[], now = Date.now()): Promise<number[]> {
  return Promise.all(counters.map(async c => {
    const { rows: [row] } = await pool.query('SELECT count FROM rate_limits WHERE bucket = $1 AND window_start = $2', [c.bucket, windowStart(c, now)]);
    return Math.max(0, c.limit - (row?.count ?? 0));
  }));
}

export async function pruneRateLimits(): Promise<void> {
  await pool.query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '3 days'`);
}
