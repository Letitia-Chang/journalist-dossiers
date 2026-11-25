import type { Request, Response, NextFunction } from 'express';
import { isDemo } from '../demo/limits';
import { clientIp } from '../lib/clientIp';
import { bucketFor, HOUR_MS, normalizeIp, take } from '../lib/rateLimit';

/** Web discovery and other outbound crawling are switched off in the public demo. */
export function blockInDemo(_req: Request, res: Response, next: NextFunction) {
  if (isDemo()) {
    return res.status(403).json({ error: 'This feature is disabled in the demo. It works when you self-host.' });
  }
  next();
}

const WRITES_PER_HOUR = 300;

/** Anyone can open the demo, so bound how much one visitor can write to its database. */
export async function limitDemoWrites(req: Request, res: Response, next: NextFunction) {
  if (!isDemo() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const granted = await take([{ bucket: bucketFor('write', normalizeIp(clientIp(req))), windowMs: HOUR_MS, limit: WRITES_PER_HOUR }]);
  if (granted === 0) return res.status(429).json({ error: 'You have made a lot of changes in the last hour. Please try again later.' });
  next();
}
