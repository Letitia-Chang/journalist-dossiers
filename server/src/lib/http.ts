import axios from 'axios';

/**
 * Identify ourselves honestly when fetching third-party pages.
 * Override with BOT_USER_AGENT, or set BOT_NAME / BOT_CONTACT_URL so site owners
 * can see who is crawling them and how to reach you.
 */
export function botUserAgent(): string {
  if (process.env.BOT_USER_AGENT) return process.env.BOT_USER_AGENT;
  const name = process.env.BOT_NAME || 'PressDossierBot';
  const contact = process.env.BOT_CONTACT_URL;
  return contact ? `${name}/1.0 (+${contact})` : `${name}/1.0`;
}

export function botName(): string {
  return process.env.BOT_NAME || 'PressDossierBot';
}

// ── robots.txt ────────────────────────────────────────────────────────────────

interface Rules { allow: string[]; disallow: string[] }
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const robotsCache = new Map<string, { rules: Rules | null; at: number }>();

/** Parse the groups of a robots.txt that apply to `agent` (falls back to `*`). */
export function parseRobots(text: string, agent: string): Rules {
  const target = agent.toLowerCase();
  const groups: { agents: string[]; rules: Rules }[] = [];
  let current: { agents: string[]; rules: Rules } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (field === 'allow') current.rules.allow.push(value);
      else if (field === 'disallow') current.rules.disallow.push(value);
    }
  }

  const specific = groups.filter(g => g.agents.some(a => a !== '*' && target.includes(a)));
  const chosen = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const merged: Rules = { allow: [], disallow: [] };
  for (const g of chosen) {
    merged.allow.push(...g.rules.allow);
    merged.disallow.push(...g.rules.disallow);
  }
  return merged;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + (escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped));
}

/** Longest-match wins; Allow beats Disallow on ties (RFC 9309). */
export function pathAllowed(rules: Rules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of rules.allow) if (p && patternToRegex(p).test(path)) bestAllow = Math.max(bestAllow, p.length);
  for (const p of rules.disallow) if (p && patternToRegex(p).test(path)) bestDisallow = Math.max(bestDisallow, p.length);
  return bestDisallow === -1 || bestAllow >= bestDisallow;
}

/**
 * Returns false only when the site's robots.txt explicitly disallows this URL for us.
 * A missing/unreachable robots.txt means "allowed", as the standard prescribes.
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const origin = u.origin;

  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.at > ROBOTS_TTL_MS) {
    let rules: Rules | null = null;
    try {
      const res = await axios.get(`${origin}/robots.txt`, {
        timeout: 5000,
        responseType: 'text',
        headers: { 'User-Agent': botUserAgent() },
        validateStatus: s => s < 500,
      });
      if (res.status === 200 && typeof res.data === 'string') rules = parseRobots(res.data, botName());
    } catch { /* unreachable → treat as allowed */ }
    entry = { rules, at: Date.now() };
    robotsCache.set(origin, entry);
  }
  if (!entry.rules) return true;
  return pathAllowed(entry.rules, u.pathname + u.search);
}
