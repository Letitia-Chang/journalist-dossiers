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
const MAX_MATCHED = 12;
const MAX_UNMATCHED = 5;

const RSS_SUFFIXES = [
  '/rss/index.xml', '/feed/', '/feed', '/rss/', '/rss', '/feed.xml', '/atom.xml',
  '?format=rss', '?rss=y', '?feed=rss2',
];
/** Machinery, never a section. */
const NEVER = /^(log-?in|log-?out|sign-?in|sign-?up|register|account|my-account|cart|checkout|search|sitemap|feed|rss|wp-(admin|content|json|login))$/i;
/** Usually a page about the site, unless it matches what the company does ("/legal" for a law company). */
const USUALLY_NOT = /^(about([-_].*)?|contact([-_]us)?|advertis(e|ing)([-_].*)?|subscribe|subscriptions?|newsletters?|profiles?|privacy([-_].*)?|terms([-_].*)?|cookies?([-_].*)?|legal([-_].*)?|careers?|jobs?|events?|store|shop|donate|support([-_]us)?|help|faqs?|authors?|staff|team|masthead|press[-_]?kit)$/i;

/** Links on a homepage worth trying for a feed: matching sections first, then a few others. */
export function sectionCandidates(html: string, homepage: string, topics: Topics): [string, string][] {
  const base = new URL(homepage);
  const $ = cheerio.load(html);
  const matched = new Map<string, string>();
  const others = new Map<string, string>();

  $('a[href]').each((_i, el) => {
    let url: URL;
    try { url = new URL($(el).attr('href') || '', base.origin); } catch { return; }
    if (url.hostname !== base.hostname || !/^https?:$/.test(url.protocol)) return;
    const segments = url.pathname.split('/').filter(Boolean);
    // The query and fragment don't make it a different section, and "#top" is just the homepage again.
    if (segments.length === 0 || segments.length > 3 || NEVER.test(segments[0])) return;
    if (/\.\w{2,5}$/.test(url.pathname)) return;
    const section = `${url.origin}/${segments.join('/')}`;
    if (matched.has(section) || others.has(section)) return;

    let slug = segments.join(' ');
    try { slug = decodeURIComponent(slug); } catch { /* keep it encoded */ }
    const text = clip($(el).text(), 100);
    const label = clip((slug.split(' ').pop() ?? text).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 60) || 'Section';
    const m = matchTopics(topics, `${text} ${slug.replace(/[-_]/g, ' ')}`, []);
    if (m.points > 0 || (m.partial > 0 && !USUALLY_NOT.test(segments[0]))) matched.set(section, label);
    else if (segments.length === 1 && !USUALLY_NOT.test(segments[0])) others.set(section, label);
  });
  return [...[...matched].slice(0, MAX_MATCHED), ...[...others].slice(0, Math.max(0, MAX_UNMATCHED - matched.size))];
}

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
      throw new Error('robots.txt disallows it or could not be loaded');
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

  const candidates = sectionCandidates(html, publicationUrl, topics);

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
    const allInactive = existingFeeds.every((f: any) => f.rss_status === 'inactive');
    await pool.query(
      allInactive
        ? `UPDATE publications SET rss_status = 'inactive', rss_status_note = 'All saved feeds are failing, and discovery found no replacements', rss_last_checked = NOW() WHERE id = $1 AND org_id = $2`
        : `UPDATE publications SET rss_last_checked = NOW() WHERE id = $1 AND org_id = $2`,
      [publicationId, orgId],
    );
    if (allInactive) generateRssDiagnosticNote(orgId, publicationId, pub.name, pub.url, { failureType: 'no_feeds_found' }).catch(() => {});
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
