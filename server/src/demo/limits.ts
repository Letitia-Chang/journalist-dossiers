/**
 * Live-AI limits for the public demo. Outside demo mode everything is allowed, so callers
 * can use these helpers unconditionally.
 *
 *  - per visitor (IP): DEMO_AI_PER_HOUR live Claude calls per rolling hour (default 5)
 *  - whole server:     DEMO_AI_PER_DAY live Claude calls per UTC day (default 150)
 *
 * State is in memory, which is fine for a single demo instance that reseeds on boot.
 */

const HOUR_MS = 60 * 60 * 1000;
const perIp = new Map<string, number[]>();
let day = { key: '', count: 0 };

export function isDemo(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function perHour(): number { return Number(process.env.DEMO_AI_PER_HOUR ?? 5); }
function perDay(): number { return Number(process.env.DEMO_AI_PER_DAY ?? 150); }

export interface LiveAiStatus {
  remaining: number;
  /** Which limit is the binding one, when remaining is 0. */
  limit?: 'hour' | 'day';
}

function recent(ip: string, now: number): number[] {
  const stamps = (perIp.get(ip) ?? []).filter(t => now - t < HOUR_MS);
  perIp.set(ip, stamps);
  return stamps;
}

function dayCount(now: number): number {
  const key = new Date(now).toISOString().slice(0, 10);
  if (day.key !== key) day = { key, count: 0 };
  return day.count;
}

export function liveAiStatus(ip: string, now = Date.now()): LiveAiStatus {
  if (!isDemo()) return { remaining: Infinity };
  const hourLeft = perHour() - recent(ip, now).length;
  const dayLeft = perDay() - dayCount(now);
  if (dayLeft <= 0) return { remaining: 0, limit: 'day' };
  if (hourLeft <= 0) return { remaining: 0, limit: 'hour' };
  return { remaining: Math.min(hourLeft, dayLeft) };
}

/** Reserve up to `want` live calls for this visitor. Returns how many were granted (0…want). */
export function takeLiveAi(ip: string, want = 1, now = Date.now()): number {
  if (!isDemo()) return want;
  const { remaining } = liveAiStatus(ip, now);
  const granted = Math.max(0, Math.min(want, remaining));
  if (granted > 0) {
    const stamps = recent(ip, now);
    for (let i = 0; i < granted; i++) stamps.push(now);
    day.count += granted;
  }
  return granted;
}

export function limitMessage(status: LiveAiStatus): string {
  return status.limit === 'day'
    ? "The demo has reached today's live-AI limit, so it can't run new analyses right now. The saved examples still work."
    : `Live AI is limited to ${perHour()} runs per hour per visitor in the demo. Try again later, or explore the saved examples.`;
}

export function resetLimits(): void {
  perIp.clear();
  day = { key: '', count: 0 };
}
