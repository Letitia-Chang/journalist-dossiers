import type { Request, Response, NextFunction } from 'express';
import { isDemo } from '../demo/limits';

/** Web discovery and other outbound crawling are switched off in the public demo. */
export function blockInDemo(_req: Request, res: Response, next: NextFunction) {
  if (isDemo()) {
    return res.status(403).json({ error: 'This feature is disabled in the demo. It works when you self-host.' });
  }
  next();
}
