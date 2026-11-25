/**
 * staffPageScanner.ts
 * Crawls a publication's public staff/authors page using cheerio (HTML parser)
 * to extract journalist names. Only reads public pages that publications
 * intentionally create to list their staff.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import pool from '../db';
import { personName } from '../lib/personName';
import { botUserAgent, isAllowedByRobots } from '../lib/http';

const STAFF_PAGE_PATHS = [
  '/authors', '/staff', '/team', '/about/team', '/contributors',
  '/writers', '/reporters', '/people', '/about/staff', '/newsroom/staff',
];
const AUTHOR_LINK_PATTERNS = [
  /\/author\//i, /\/authors\//i, /\/staff\//i, /\/writer\//i,
  /\/reporter\//i, /\/contributor\//i, /\/people\//i, /\/team\//i, /\/profile\//i,
];
const GENERIC_NAMES = new Set([
  'staff', 'admin', 'editor', 'editors', 'editorial', 'team', 'contributor',
  'contributors', 'writer', 'writers', 'reporter', 'reporters', 'author', 'authors',
  'guest', 'wire', 'ap', 'reuters', 'associated press', 'bloomberg wire', 'newsroom',
]);

function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has(name.toLowerCase().trim()) || name.trim().length < 4;
}
async function fetchPage(url: string): Promise<string | null> {
  try {
    if (!(await isAllowedByRobots(url))) return null; // respect robots.txt
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': botUserAgent(), 'Accept': 'text/html' },
      maxRedirects: 3,
    });
    if (typeof res.data === 'string') return res.data;
    return null;
  } catch { return null; }
}
function normalizeBase(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch { return url.replace(/\/$/, ''); }
}
function extractNamesFromHtml(html: string, _baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const names = new Set<string>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const isAuthorLink = AUTHOR_LINK_PATTERNS.some(p => p.test(href));
    if (!isAuthorLink) return;
    const text = $(el).text().trim() || $(el).attr('aria-label')?.trim() || $(el).attr('title')?.trim() || '';
    const name = isGenericName(text) ? null : personName(text);
    if (name) names.add(name);
  });
  if (names.size < 3) {
    $('[class*="name"], [class*="author"], [class*="writer"], [itemprop="name"]').each((_i, el) => {
      const text = $(el).text().trim();
      const name = isGenericName(text) ? null : personName(text);
      if (name) names.add(name);
    });
  }
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).html() || '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name) {
          const name = isGenericName(item.name) ? null : personName(item.name);
          if (name) names.add(name);
        }
      }
    } catch { /* ignore */ }
  });
  return [...names];
}

export interface StaffScanResult {
  found: number;
  added: number;
  skipped: number;
  names: string[];
  pageScanned: string | null;
  error?: string;
}

export async function scanStaffPage(orgId: string, publicationId: number): Promise<StaffScanResult> {
  const pub = (await pool.query('SELECT * FROM publications WHERE id = $1 AND org_id = $2', [publicationId, orgId])).rows[0];
  if (!pub) return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'Publication not found' };
  if (!pub.url) return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'Publication has no URL' };

  const base = normalizeBase(pub.url);
  let html: string | null = null;
  let pageScanned: string | null = null;

  for (const path of STAFF_PAGE_PATHS) {
    const url = `${base}${path}`;
    html = await fetchPage(url);
    if (html && html.length > 500) { pageScanned = url; break; }
  }

  if (!html || !pageScanned) {
    return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'No accessible staff page found' };
  }

  const names = extractNamesFromHtml(html, base).filter(n => n.length <= 200).slice(0, 500);
  console.log(`[StaffScanner] "${pub.name}" → ${names.length} names from ${pageScanned}`);

  let added = 0;
  let skipped = 0;

  for (const name of names) {
    const existingJournalist = (await pool.query(
      'SELECT id FROM journalists WHERE org_id = $1 AND publication_id = $2 AND LOWER(name) = LOWER($3)',
      [orgId, publicationId, name]
    )).rows[0];
    if (existingJournalist) { skipped++; continue; }

    const existingSuggestion = (await pool.query(
      `SELECT id FROM journalist_suggestions WHERE org_id = $1 AND publication_id = $2 AND LOWER(name) = LOWER($3) AND status = 'pending'`,
      [orgId, publicationId, name]
    )).rows[0];
    if (existingSuggestion) { skipped++; continue; }

    const recentReject = (await pool.query(
      `SELECT id FROM journalist_suggestions WHERE org_id = $1 AND publication_id = $2 AND LOWER(name) = LOWER($3)
       AND status = 'rejected' AND created_at > NOW() - INTERVAL '30 days'`,
      [orgId, publicationId, name]
    )).rows[0];
    if (recentReject) { skipped++; continue; }

    await pool.query(
      `INSERT INTO journalist_suggestions
         (org_id, name, publication_id, source_type, source_url, status)
       VALUES ($1, $2, $3, 'staffpage', $4, 'pending')`,
      [orgId, name, publicationId, pageScanned],
    );
    added++;
  }

  return { found: names.length, added, skipped, names, pageScanned };
}
