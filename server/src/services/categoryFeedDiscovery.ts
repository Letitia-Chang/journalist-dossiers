import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import pool from '../db';
import { clip } from '../lib/clip';
import { loadProfile } from '../lib/companyProfile';
import { matchTopics, topicsFrom, type Topics } from '../lib/topics';
import { generateRssDiagnosticNote } from './rssDiagnostic';
import { botUserAgent, isAllowedByRobots } from '../lib/http';

const parser = new Parser({ timeout: 8000, headers: { 'User-Agent': botUserAgent() } });

/** Each candidate can cost several requests, so stay polite. */
const MAX_MATCHED = 20;
const MAX_UNMATCHED = 5;

const RSS_SUFFIXES = [
  '/rss/index.xml', '/feed/', '/feed', '/rss/', '/rss', '/feed.xml', '/atom.xml',
  '?format=rss', '?rss=y', '?feed=rss2',
];
const IGNORE_PATHS = new Set([
  '/', '/about', '/contact', '/advertise', '/subscribe', '/newsletter',
  '/login', '/signup', '/account', '/search', '/sitemap', '/privacy', '/terms',
  '/careers', '/jobs', '/events', '/store', '/shop',
]);

export interface DiscoveredFeed {
  feedUrl: string;
  feedLabel: string;
  sectionUrl: string;
  itemCount: number;
}

export async function discoverCategoryFeeds(publicationUrl: string, topics: Topics): Promise<DiscoveredFeed[]> {
  const baseUrl = new URL(publicationUrl);
  let html: string;
  try {
    if (!(await isAllowedByRobots(publicationUrl))) {
      throw new Error('disallowed by robots.txt');
    }
    const res = await axios.get(publicationUrl, {
      timeout: 12000,
      headers: { 'User-Agent': botUserAgent() },
      maxRedirects: 5,
    });
    html = res.data as string;
  } catch (err: any) {
    throw new Error(`Failed to fetch ${publicationUrl}: ${err.message}`, { cause: err });
  }

  const $ = cheerio.load(html);
  // Sections that match what the company does, then, so a publication is never skipped, a few others.
  const matched = new Map<string, string>();
  const others = new Map<string, string>();

  $('a[href]').each((_i, el) => {
    const rawHref = $(el).attr('href') || '';
    const text = $(el).text().trim();
    let absUrl: string;
    try { absUrl = new URL(rawHref, baseUrl.origin).href; } catch { return; }
    try { const u = new URL(absUrl); if (u.hostname !== baseUrl.hostname) return; } catch { return; }
    const path = absUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
    if (IGNORE_PATHS.has(path)) return;
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 3) return;
    if (/\.(html?|php|aspx|jpg|png|pdf)$/i.test(path)) return;
    if (matched.has(absUrl) || others.has(absUrl)) return;
    const label = clip(segments[segments.length - 1]?.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || text || 'Section', 60);
    const isMatch = matchTopics(topics, `${text.slice(0, 100)} ${segments.join(' ').replace(/[-_]/g, ' ')}`, []).points > 0;
    if (isMatch) matched.set(absUrl, label);
    else if (segments.length === 1) others.set(absUrl, label);
  });
  const candidates = [...[...matched].slice(0, MAX_MATCHED), ...(matched.size >= MAX_UNMATCHED ? [] : [...others].slice(0, MAX_UNMATCHED - matched.size))];

  console.log(`[FeedDiscovery] ${baseUrl.hostname}: ${candidates.length} candidate section URLs`);

  const found: DiscoveredFeed[] = [];
  const checkedFeedUrls = new Set<string>();

  for (const [sectionUrl, label] of candidates) {
    if (found.length >= 6) break;
    for (const suffix of RSS_SUFFIXES) {
      const candidate = sectionUrl.replace(/\/$/, '') + suffix;
      if (checkedFeedUrls.has(candidate)) continue;
      checkedFeedUrls.add(candidate);
      try {
        const feed = await parser.parseURL(candidate);
        const itemCount = feed.items?.length ?? 0;
        if (itemCount > 0) {
          const feedTitle = feed.title?.trim();
          const cleanLabel = feedTitle && feedTitle.length < 60 && !feedTitle.toLowerCase().includes('rss') ? feedTitle : label;
          found.push({ feedUrl: candidate, feedLabel: cleanLabel, sectionUrl, itemCount });
          break;
        }
      } catch { /* not a valid feed */ }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return found;
}

export interface FeedDiscoveryResult {
  publicationId: number;
  publicationName: string;
  feedsFound: number;
  feedsAdded: number;
  feeds: DiscoveredFeed[];
  error?: string;
}

export async function discoverAndSaveFeeds(orgId: string, publicationId: number): Promise<FeedDiscoveryResult> {
  const pub = (await pool.query('SELECT * FROM publications WHERE id = $1 AND org_id = $2', [publicationId, orgId])).rows[0];
  if (!pub) throw new Error(`Publication ${publicationId} not found`);
  if (!pub.url) throw new Error(`Publication "${pub.name}" has no homepage URL`);

  let feeds: DiscoveredFeed[];
  try {
    feeds = await discoverCategoryFeeds(pub.url, topicsFrom(await loadProfile(orgId)));
  } catch (err: any) {
    // Only set 'none' if there are truly no saved feeds — if broken feeds exist, leave status for scan to determine
    const existingCount = (await pool.query(
      'SELECT COUNT(*) as c FROM publication_feeds WHERE publication_id = $1 AND org_id = $2', [publicationId, orgId]
    )).rows[0].c;
    if (Number(existingCount) === 0) {
      await pool.query(
        `UPDATE publications SET rss_status = 'none', rss_status_note = $1, rss_last_checked = NOW() WHERE id = $2 AND org_id = $3`,
        [`Discovery failed: ${err.message}`, publicationId, orgId]
      );
    } else {
      await pool.query(
        `UPDATE publications SET rss_last_checked = NOW() WHERE id = $1 AND org_id = $2`, [publicationId, orgId]
      );
    }
    generateRssDiagnosticNote(orgId, publicationId, pub.name, pub.url, {
      failureType: 'fetch_error',
      errorMessage: err.message,
    }).catch(() => {});
    return { publicationId, publicationName: pub.name, feedsFound: 0, feedsAdded: 0, feeds: [], error: err.message };
  }

  const existingFeeds = (await pool.query(
    'SELECT feed_url, rss_status FROM publication_feeds WHERE publication_id = $1 AND org_id = $2', [publicationId, orgId]
  )).rows;
  const existingUrls = new Set(existingFeeds.map((r: any) => r.feed_url.toLowerCase()));
  const hasExistingFeeds = existingFeeds.length > 0;

  let added = 0;
  for (const feed of feeds) {
    if (!existingUrls.has(feed.feedUrl.toLowerCase())) {
      await pool.query(
        `INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type, rss_status)
         VALUES ($1, $2, $3, $4, 'category', 'unknown')`,
        [orgId, publicationId, feed.feedUrl, feed.feedLabel]
      );
      added++;
    }
  }

  // Update publication rss_status and note based on whether feeds were found
  if (feeds.length > 0) {
    await pool.query(
      `UPDATE publications SET rss_status = 'active', rss_status_note = $1, rss_last_checked = NOW() WHERE id = $2 AND org_id = $3`,
      [`${feeds.length} feed${feeds.length !== 1 ? 's' : ''} discovered automatically`, publicationId, orgId]
    );
  } else if (hasExistingFeeds) {
    // Feeds exist but discovery found nothing new.
    // If ALL existing feeds are inactive (broken), delete them and reset to 'none' —
    // keeping dead feed URLs is misleading; a clean "No RSS" state is more honest.
    const allInactive = existingFeeds.every((f: any) => f.rss_status === 'inactive');
    if (allInactive) {
      await pool.query(
        'DELETE FROM publication_feeds WHERE publication_id = $1 AND org_id = $2',
        [publicationId, orgId]
      );
      await pool.query(
        `UPDATE publications SET rss_status = 'none', rss_status_note = $1, rss_last_checked = NOW() WHERE id = $2 AND org_id = $3`,
        [`All previously saved feeds are broken. Auto-discovery found no replacements.`, publicationId, orgId]
      );
      generateRssDiagnosticNote(orgId, publicationId, pub.name, pub.url, {
        failureType: 'no_feeds_found',
      }).catch(() => {});
    } else {
      await pool.query(
        `UPDATE publications SET rss_last_checked = NOW() WHERE id = $1 AND org_id = $2`,
        [publicationId, orgId]
      );
    }
  } else {
    // Truly no feeds anywhere — mark as none and generate diagnostic
    await pool.query(
      `UPDATE publications SET rss_status = 'none', rss_status_note = $1, rss_last_checked = NOW() WHERE id = $2 AND org_id = $3`,
      [`Auto-discovery scanned the homepage but found no RSS feeds`, publicationId, orgId]
    );
    generateRssDiagnosticNote(orgId, publicationId, pub.name, pub.url, {
      failureType: 'no_feeds_found',
    }).catch(() => {});
  }

  console.log(`[FeedDiscovery] ${pub.name}: ${feeds.length} found, ${added} new`);
  return { publicationId, publicationName: pub.name, feedsFound: feeds.length, feedsAdded: added, feeds };
}
