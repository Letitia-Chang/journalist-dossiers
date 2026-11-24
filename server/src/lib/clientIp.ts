import type { Request } from 'express';

/**
 * The visitor's address, used to key the per-visitor demo limits.
 *
 * `req.ip` is only right when `trust proxy` matches the number of proxies in front of the app.
 * Render sits behind Cloudflare, so with a single trusted hop it resolves to a Cloudflare edge
 * address: unrelated visitors can share one bucket and one visitor can be spread across several.
 * Set CLIENT_IP_HEADER (render.yaml uses `cf-connecting-ip`) to read the address from a header the
 * edge proxy sets and overwrites. Only set it when every request really passes through that proxy,
 * otherwise a client could send the header itself.
 */
export function clientIp(req: Pick<Request, 'headers' | 'ip'>): string {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (name) {
    const raw = req.headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
    if (value) return value;
  }
  return req.ip ?? 'local';
}
