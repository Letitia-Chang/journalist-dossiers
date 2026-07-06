import type { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';

function computeToken(): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  const password = process.env.APP_PASSWORD ?? '';
  return createHmac('sha256', secret).update(password).digest('hex');
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (header.slice(7) !== computeToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export function loginHandler(req: Request, res: Response) {
  const { password } = req.body as { password?: string };
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: computeToken() });
}
