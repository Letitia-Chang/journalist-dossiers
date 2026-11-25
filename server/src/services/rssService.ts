import Parser from 'rss-parser';
import { clip, clipDate, clipUrl } from '../lib/clip';
import pool from '../db';
import { personName } from '../lib/personName';
import { loadProfile } from '../lib/companyProfile';
import { commonCategory, matchTopics, relevance, strength, topicsFrom, type Topics } from '../lib/topics';
import { generateRssDiagnosticNote } from './rssDiagnostic';
import { botUserAgent } from '../lib/http';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': botUserAgent() },
  customFields: { item: [['dc:creator', 'creator'], ['author', 'author']] },
});

export interface RssScanResult {
  publicationId: number;
  publicationName: string;
  newSuggestions: number;
  status: 'active' | 'inactive' | 'none';
  error?: string;
}

interface ArticleData { title: string; url: string; date: string; categories: string[] }
interface AuthorRelevance { relevanceScore: number; matchedTags: string[]; bestArticle: ArticleData; articleCount: number }

function scoreAuthor(articles: ArticleData[], topics: Topics): AuthorRelevance {
  const matches = articles.map(a => matchTopics(topics, a.title, a.categories));
  const best = matches.reduce((b, _m, i) => (strength(matches[i]) > strength(matches[b]) ? i : b), 0);
  return {
    relevanceScore: relevance(matches),
    matchedTags: [...new Set(matches.flatMap(m => m.matched))].slice(0, 8),
    bestArticle: articles[best],
    articleCount: articles.length,
  };
}

function extractAuthor(item: any): string | null {
  const raw = item.creator || item.author || item['dc:creator'] || (item.itunes && item.itunes.author) || null;
  if (!raw || typeof raw !== 'string') return null;
  const name = raw.replace(/^[^\s(]+@[^\s(]+\s*/, '').replace(/<[^>]+>/g, '').replace(/\(([^)]+)\)/, '$1').trim();
  if (/'\d{2}$/.test(name)) return null; // "Jane Roe '25"
  return personName(name);
}

async function scanFeedUrl(feedUrl: string, feedId: number): Promise<{ items: any[]; error?: string }> {
  try {
    const feed = await parser.parseURL(feedUrl);
    await pool.query(`UPDATE publication_feeds SET rss_status = 'active', rss_last_checked = NOW() WHERE id = $1`, [feedId]);
    return { items: feed.items ?? [] };
  } catch (err: any) {
    await pool.query(`UPDATE publication_feeds SET rss_status = 'inactive', rss_last_checked = NOW() WHERE id = $1`, [feedId]);
    return { items: [], error: err.message };
  }
}

export async function scanPublicationRss(orgId: string, publicationId: number): Promise<RssScanResult> {
  const pub = (await pool.query('SELECT * FROM publications WHERE id = $1 AND org_id = $2', [publicationId, orgId])).rows[0];
  if (!pub) throw new Error(`Publication ${publicationId} not found`);

  let feeds = (await pool.query(
    'SELECT * FROM publication_feeds WHERE publication_id = $1 AND org_id = $2', [publicationId, orgId]
  )).rows;

  if (feeds.length === 0 && pub.rss_url) {
    await pool.query(
      `INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
       VALUES ($1, $2, $3, 'Main', 'main')`,
      [orgId, publicationId, pub.rss_url]
    );
    feeds = (await pool.query(
      'SELECT * FROM publication_feeds WHERE publication_id = $1 AND org_id = $2', [publicationId, orgId]
    )).rows;
  }

  if (feeds.length === 0) {
    await pool.query(
      `UPDATE publications SET rss_status = 'none', rss_status_note = 'No feeds have been added — run auto-discovery or add a feed URL manually', rss_last_checked = NOW() WHERE id = $1 AND org_id = $2`,
      [publicationId, orgId]
    );
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'none' };
  }

  const allItems: any[] = [];
  let anyActive = false;

  for (const feed of feeds) {
    const { items, error } = await scanFeedUrl(feed.feed_url, feed.id);
    if (!error) anyActive = true;
    allItems.push(...items);
    if (feeds.length > 1) await new Promise(r => setTimeout(r, 300));
  }

  const pubStatus = anyActive ? 'active' : 'inactive';
  const pubNote = anyActive
    ? `${feeds.length} feed${feeds.length !== 1 ? 's' : ''} active and returning articles`
    : `All ${feeds.length} feed${feeds.length !== 1 ? 's' : ''} failed to parse — URLs may be outdated or blocked`;
  await pool.query(
    `UPDATE publications SET rss_status = $1, rss_status_note = $2, rss_last_checked = NOW() WHERE id = $3 AND org_id = $4`,
    [pubStatus, pubNote, publicationId, orgId]
  );

  // If all feeds failed, ask Claude to diagnose why and suggest an action
  if (!anyActive) {
    const failedUrls = feeds.map((f: any) => f.feed_url);
    generateRssDiagnosticNote(orgId, publicationId, pub.name, pub.url, {
      failureType: 'feeds_failed',
      feedUrls: failedUrls,
    }).catch(() => {});
  }

  if (!anyActive) return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive' };

  try {
    const existingNames = new Set(
      (await pool.query('SELECT LOWER(name) as n FROM journalists WHERE org_id = $1 AND publication_id = $2', [orgId, publicationId])).rows.map((j: any) => j.n)
    );
    const pendingNames = new Set(
      (await pool.query(`SELECT LOWER(name) as n FROM journalist_suggestions WHERE org_id = $1 AND publication_id = $2 AND status = 'pending'`, [orgId, publicationId])).rows.map((j: any) => j.n)
    );
    const rejectedNames = new Set(
      (await pool.query(`SELECT LOWER(name) as n FROM journalist_suggestions WHERE org_id = $1 AND publication_id = $2 AND status = 'rejected' AND created_at >= NOW() - INTERVAL '30 days'`, [orgId, publicationId])).rows.map((j: any) => j.n)
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const authorArticles = new Map<string, ArticleData[]>();

    for (const item of allItems) {
      const author = extractAuthor(item);
      if (!author) continue;
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      if (pubDate && pubDate < cutoff) continue;
      const articles = authorArticles.get(author) || [];
      if (articles.length >= 10) continue;
      articles.push({
        title: clip(item.title, 300),
        url: clipUrl(item.link) || clipUrl(item.guid),
        date: clipDate(item.pubDate) ?? '',
        categories: (Array.isArray(item.categories) ? item.categories : []).slice(0, 20).map((c: unknown) => clip(c, 80)),
      });
      authorArticles.set(author, articles);
    }

    const topics = topicsFrom(await loadProfile(orgId));
    let added = 0;
    for (const [author, articles] of authorArticles) {
      const key = author.toLowerCase();
      if (existingNames.has(key) || pendingNames.has(key) || rejectedNames.has(key)) continue;

      const { relevanceScore, matchedTags, bestArticle, articleCount } = scoreAuthor(articles, topics);
      const beat = commonCategory(articles.map(a => a.categories));

      await pool.query(
        `INSERT INTO journalist_suggestions
           (org_id, name, publication_id, source_type,
            recent_article_title, recent_article_url, recent_article_date,
            suggested_beat, relevance_score, matched_tags, article_count, all_articles, status)
         VALUES ($1,$2,$3,'rss',$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
        [
          orgId, author, publicationId,
          bestArticle.title, bestArticle.url, bestArticle.date,
          beat, relevanceScore, JSON.stringify(matchedTags), articleCount, JSON.stringify(articles),
        ],
      );
      added++;
    }

    console.log(`[RSS] ${pub.name}: ${authorArticles.size} authors, ${added} new suggestions`);
    return { publicationId, publicationName: pub.name, newSuggestions: added, status: 'active' };
  } catch (err: any) {
    console.error(`[RSS] ${pub.name} processing failed:`, err.message);
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive', error: err.message };
  }
}

export async function scanAllRssFeeds(orgId: string): Promise<RssScanResult[]> {
  const pubs = (await pool.query(
    `SELECT p.id FROM publications p
     WHERE p.org_id = $1 AND p.active = true
       AND (p.rss_url <> '' OR EXISTS (SELECT 1 FROM publication_feeds f WHERE f.publication_id = p.id))
     ORDER BY p.id`,
    [orgId],
  )).rows as { id: number }[];

  console.log(`[RSS] Starting scan of ${pubs.length} publications for org ${orgId}...`);
  const results: RssScanResult[] = [];
  for (const pub of pubs) {
    const result = await scanPublicationRss(orgId, pub.id);
    results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }
  const total = results.reduce((s, r) => s + r.newSuggestions, 0);
  console.log(`[RSS] Scan complete. ${total} new suggestions across ${pubs.length} feeds.`);
  return results;
}
