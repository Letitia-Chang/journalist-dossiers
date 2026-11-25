import { link } from './schemas';

/** Make text from a feed, a web page or a model safe to store: one line, no control characters, capped. */
export function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const clean = [...value].map(c => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('').trim();
  return clean.slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trimEnd(); // don't cut an emoji in half
}

/** A discovered URL, or '' when it is not an http(s) link we would accept from a person. */
export function clipUrl(value: unknown): string {
  const parsed = link.safeParse(value);
  return parsed.success ? parsed.data : '';
}

/** A discovered date as ISO, or null when it cannot be parsed. Feeds use every format there is. */
export function clipDate(value: unknown): string | null {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year >= 1900 && year <= 2200 ? new Date(t).toISOString() : null;
}
