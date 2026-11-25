import type { Request, Response, NextFunction } from 'express';
import { isDemo } from '../demo/limits';
import { clientIp } from '../lib/clientIp';
import { bucketFor, DAY_MS, HOUR_MS, normalizeIp, take } from '../lib/rateLimit';

/** Web discovery and other outbound crawling are switched off in the public demo. */
export function blockInDemo(_req: Request, res: Response, next: NextFunction) {
  if (isDemo()) {
    return res.status(403).json({ error: 'This feature is disabled in the demo. It works when you self-host.' });
  }
  next();
}

/** Writes allowed per visitor per hour, per sandbox per day, and across the whole demo per day. */
export const DEMO_WRITES = { visitorHour: 120, sandboxDay: 400, globalDay: 10_000 };

/** Anyone can open the demo, so bound how much can be written to its database. */
export async function limitDemoWrites(req: Request, res: Response, next: NextFunction) {
  if (!isDemo() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const granted = await take([
    { bucket: bucketFor('write', normalizeIp(clientIp(req))), windowMs: HOUR_MS, limit: DEMO_WRITES.visitorHour },
    { bucket: `write-org:${req.orgId}`, windowMs: DAY_MS, limit: DEMO_WRITES.sandboxDay },
    { bucket: 'write-all', windowMs: DAY_MS, limit: DEMO_WRITES.globalDay },
  ]);
  if (granted === 0) return res.status(429).json({ error: 'The demo has had a lot of changes in a short time. Please try again later.' });
  next();
}
