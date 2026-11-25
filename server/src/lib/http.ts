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
const EVERYTHING: Rules = { allow: [], disallow: [] };
const NOTHING: Rules = { allow: [], disallow: ['/'] };
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const UNREACHABLE_TTL_MS = 5 * 60 * 1000;
const robotsCache = new Map<string, { rules: Rules; until: number }>();

/** Parse the groups of a robots.txt that name `agent` (its product token, ignoring case), or else `*`. */
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
      current.agents.push(value.toLowerCase().replace(/\/.*$/, '').trim()); // "Name/1.0" names "Name"
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (field === 'allow') current.rules.allow.push(value);
      else if (field === 'disallow') current.rules.disallow.push(value);
    }
  }

  const specific = groups.filter(g => g.agents.includes(target));
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
 * May we fetch this URL? As RFC 9309 prescribes, a site without a robots.txt (4xx) allows everything,
 * and one whose robots.txt can't be reached (5xx, network error) allows nothing for now. We also wait
 * when rate limited (429).
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const origin = u.origin;

  let entry = robotsCache.get(origin);
  if (!entry || Date.now() > entry.until) {
    let rules = NOTHING;
    let ttl = UNREACHABLE_TTL_MS;
    try {
      const res = await axios.get(`${origin}/robots.txt`, {
        timeout: 5000,
        responseType: 'text',
        headers: { 'User-Agent': botUserAgent() },
        validateStatus: () => true,
      });
      if (res.status < 500 && res.status !== 429) {
        rules = res.status === 200 ? parseRobots(String(res.data), botName()) : EVERYTHING;
        ttl = ROBOTS_TTL_MS;
      }
    } catch { /* unreachable */ }
    entry = { rules, until: Date.now() + ttl };
    robotsCache.set(origin, entry);
  }
  return pathAllowed(entry.rules, u.pathname + u.search);
}
