import { createHmac } from 'crypto';
import { isIPv6 } from 'net';
import pool, { inTransaction } from '../db';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface Counter { bucket: string; windowMs: number; limit: number }

/** One home connection owns a whole IPv6 /64, so every address in it is the same visitor. */
export function normalizeIp(ip: string): string {
  return prefix(ip, 4);
}

/** The wider network: a /48 for IPv6 (what one customer can rotate through), the address for IPv4. */
export function networkOf(ip: string): string {
  return prefix(ip, 3);
}

function prefix(ip: string, groups: number): string {
  const addr = ip.replace(/%.*$/, '').toLowerCase();
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return mapped[1];
  if (!isIPv6(addr)) return addr;
  const [head, tail] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const all = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  // The same IPv4 address can also be written in hex.
  if (all.slice(0, 5).every(g => parseInt(g, 16) === 0) && parseInt(all[5], 16) === 0xffff) {
    const [hi, lo] = [parseInt(all[6], 16), parseInt(all[7], 16)];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return `${all.slice(0, groups).map(g => parseInt(g, 16).toString(16)).join(':')}::/${groups * 16}`;
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
  // Any error propagates: no counter, no spend.
  return inTransaction(async db => {
    let granted = want;
    for (const c of sorted) {
      const { rows: [row] } = await db.query(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, $2, 0)
         ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count
         RETURNING count`,
        [c.bucket, windowStart(c, now)],
      );
      granted = Math.max(0, Math.min(granted, c.limit - row.count));
    }
    if (granted > 0) {
      for (const c of sorted) {
        await db.query('UPDATE rate_limits SET count = count + $3 WHERE bucket = $1 AND window_start = $2', [c.bucket, windowStart(c, now), granted]);
      }
    }
    return granted;
  });
}

/** Return one unit to each counter, for attempts that turned out not to count. */
export async function giveBack(counters: Counter[], now = Date.now()): Promise<void> {
  await inTransaction(async db => {
    for (const c of [...counters].sort((a, b) => (a.bucket < b.bucket ? -1 : 1))) {
      await db.query('UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE bucket = $1 AND window_start = $2', [c.bucket, windowStart(c, now)]);
    }
  });
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
