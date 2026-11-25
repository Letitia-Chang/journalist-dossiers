import { bucketFor, DAY_MS, HOUR_MS, normalizeIp, remaining, take, type Counter } from '../lib/rateLimit';

/**
 * Live-AI limits for the public demo. Outside demo mode everything is allowed, so callers can use
 * these helpers unconditionally.
 *
 *  - per visitor (hashed IP): DEMO_AI_PER_HOUR live Claude calls per clock hour (default 5)
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
const dayCounter = (): Counter => ({ bucket: 'ai-day', windowMs: DAY_MS, limit: perDay() });

export interface LiveAiStatus {
  remaining: number;
  /** Which limit is the binding one, when remaining is 0. */
  limit?: 'hour' | 'day';
}

export async function liveAiStatus(ip: string, now = Date.now()): Promise<LiveAiStatus> {
  if (!isDemo()) return { remaining: Infinity };
  const [hourLeft, dayLeft] = await remaining([hourCounter(ip), dayCounter()], now);
  if (dayLeft <= 0) return { remaining: 0, limit: 'day' };
  if (hourLeft <= 0) return { remaining: 0, limit: 'hour' };
  return { remaining: Math.min(hourLeft, dayLeft) };
}

/** Reserve up to `want` live calls for this visitor. Returns how many were granted (0…want). */
export async function takeLiveAi(ip: string, want = 1, now = Date.now()): Promise<number> {
  if (!isDemo()) return want;
  return take([hourCounter(ip), dayCounter()], want, now);
}

export function limitMessage(status: LiveAiStatus): string {
  return status.limit === 'day'
    ? "The demo has reached today's live-AI limit, so it can't run new analyses right now. The saved examples still work."
    : `Live AI is limited to ${perHour()} runs per hour per visitor in the demo. Try again later, or explore the saved examples.`;
}
