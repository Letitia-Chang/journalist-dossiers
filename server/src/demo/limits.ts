import { bucketFor, DAY_MS, HOUR_MS, networkOf, normalizeIp, remaining, take, type Counter } from '../lib/rateLimit';

/**
 * Live-AI limits for the public demo. Outside demo mode everything is allowed, so callers can use
 * these helpers unconditionally.
 *
 *  - per visitor (hashed IP): DEMO_AI_PER_HOUR live Claude calls per clock hour (default 5)
 *  - per network (IPv6 /48): AI_PER_NETWORK_DAY per UTC day, so one person with many addresses can't use
 *    up the day for everyone
 *  - whole deployment:        DEMO_AI_PER_DAY live Claude calls per UTC day (default 150)
 *
 * Counts live in Postgres, so a restart, a crash or a second instance can't reset them.
 */

export function isDemo(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback; // a typo must not mean "unlimited"
}
const perHour = () => envLimit('DEMO_AI_PER_HOUR', 5);
const perDay = () => envLimit('DEMO_AI_PER_DAY', 150);

const hourCounter = (ip: string): Counter => ({ bucket: bucketFor('ai-hour', normalizeIp(ip)), windowMs: HOUR_MS, limit: perHour() });
/** Generous for a person, small next to the daily total. */
export const AI_PER_NETWORK_DAY = 20;
const networkCounter = (ip: string): Counter => ({ bucket: bucketFor('ai-net', networkOf(ip)), windowMs: DAY_MS, limit: AI_PER_NETWORK_DAY });
const dayCounter = (): Counter => ({ bucket: 'ai-day', windowMs: DAY_MS, limit: perDay() });

export interface LiveAiStatus {
  remaining: number;
  /** Which limit is the binding one, when remaining is 0. */
  limit?: 'hour' | 'network' | 'day';
}

export async function liveAiStatus(ip: string, now = Date.now()): Promise<LiveAiStatus> {
  if (!isDemo()) return { remaining: Infinity };
  const [hourLeft, networkLeft, dayLeft] = await remaining([hourCounter(ip), networkCounter(ip), dayCounter()], now);
  if (dayLeft <= 0) return { remaining: 0, limit: 'day' };
  if (networkLeft <= 0) return { remaining: 0, limit: 'network' };
  if (hourLeft <= 0) return { remaining: 0, limit: 'hour' };
  return { remaining: Math.min(hourLeft, networkLeft, dayLeft) };
}

/** Reserve up to `want` live calls for this visitor. Returns how many were granted (0…want). */
export async function takeLiveAi(ip: string, want = 1, now = Date.now()): Promise<number> {
  if (!isDemo()) return want;
  return take([hourCounter(ip), networkCounter(ip), dayCounter()], want, now);
}

export function limitMessage(status: LiveAiStatus): string {
  if (status.limit === 'network') return "You've used today's live-AI runs in the demo. Try again tomorrow, or explore the saved examples.";
  return status.limit === 'day'
    ? "The demo has reached today's live-AI limit, so it can't run new analyses right now. The saved examples still work."
    : `Live AI is limited to ${perHour()} runs per hour per visitor in the demo. Try again later, or explore the saved examples.`;
}
