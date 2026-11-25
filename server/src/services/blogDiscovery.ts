/**
 * Blog / publication discovery service.
 * Queries multiple sources in parallel and returns a unified, deduplicated list.
 *
 * Sources:
 *   1. Feedly feed search  — broad RSS/blog index, no API key needed
 *   2. Substack search     — newsletters on Substack
 *   3. Medium tag feeds    — derived from query keywords, always valid
 */

import { searchTags } from '../lib/topics';
import { clip } from '../lib/clip';
import axios from 'axios';
import { botUserAgent } from '../lib/http';

export interface DiscoveredPublication {
  name: string;
  url: string;
  feedUrl: string;
  description: string;
  source: 'feedly' | 'substack' | 'medium';
  subscribers?: number;       // Feedly subscriber count where available
  suggestedTier: 'A' | 'B' | 'C';
  focus: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '').toLowerCase();
  } catch { return url.toLowerCase(); }
}

function guessTier(subscribers?: number): 'A' | 'B' | 'C' {
  if (!subscribers) return 'C';
  if (subscribers >= 50_000) return 'A';
  if (subscribers >= 5_000)  return 'B';
  return 'C';
}

// ── Source 1: Feedly feed search ──────────────────────────────────────────────
// Public endpoint — no API key required for basic queries.
async function queryFeedly(query: string): Promise<DiscoveredPublication[]> {
  try {
    const res = await axios.get('https://cloud.feedly.com/v3/search/feeds', {
      params: { q: query, count: 30, locale: 'en' },
      timeout: 10_000,
      headers: { 'User-Agent': botUserAgent() },
    });

    const results: DiscoveredPublication[] = [];
    for (const item of res.data?.results || []) {
      // feedId format: "feed/https://example.com/rss"
      const feedUrl = item.feedId?.replace(/^feed\//, '') || '';
      const siteUrl = item.website || feedUrl;
      if (!feedUrl || !siteUrl) continue;

      results.push({
        name:           item.title || item.visualUrl || extractDomain(siteUrl),
        url:            siteUrl,
        feedUrl,
        description:    clip(item.description, 2000),
        source:         'feedly',
        subscribers:    item.subscribers || 0,
        suggestedTier:  guessTier(item.subscribers),
        focus:          clip(item.description, 2000),
      });
    }
    return results;
  } catch (err: any) {
    console.warn('[Discover] Feedly error:', err.message);
    return [];
  }
}

// ── Source 2: Substack search ──────────────────────────────────────────────────
// Substack's public search API — no auth needed.
async function querySubstack(query: string): Promise<DiscoveredPublication[]> {
  try {
    const res = await axios.get('https://substack.com/api/v1/search', {
      params: { query, type: 'publication', offset: 0 },
      timeout: 10_000,
      headers: { 'User-Agent': botUserAgent() },
    });

    const pubs = res.data?.publications || res.data?.results || [];
    const results: DiscoveredPublication[] = [];

    for (const p of pubs) {
      const subdomain = p.subdomain || p.custom_domain_optional;
      if (!subdomain) continue;

      const baseUrl = p.custom_domain
        ? `https://${p.custom_domain}`
        : `https://${subdomain}.substack.com`;

      const feedUrl = `${baseUrl}/feed`;

      results.push({
        name:          p.name || subdomain,
        url:           baseUrl,
        feedUrl,
        description:   clip(p.description, 2000),
        source:        'substack',
        subscribers:   p.subscriber_count || 0,
        suggestedTier: guessTier(p.subscriber_count),
        focus:         clip(p.description, 2000),
      });
    }
    return results;
  } catch (err: any) {
    console.warn('[Discover] Substack error:', err.message);
    return [];
  }
}

// ── Source 3: Medium tag feeds ─────────────────────────────────────────────────
// Medium exposes RSS at medium.com/feed/tag/{tag}.
// Tags come only from what the person searched for.
async function queryMedium(query: string): Promise<DiscoveredPublication[]> {
  const tags = searchTags(query);
  return tags.map(tag => ({
    name:          `Medium — ${tag.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
    url:           `https://medium.com/tag/${encodeURIComponent(tag)}`,
    feedUrl:       `https://medium.com/feed/tag/${encodeURIComponent(tag)}`,
    description:   `Medium articles tagged "${tag.replace(/-/g, ' ')}"`,
    source:        'medium' as const,
    suggestedTier: 'B' as const,
    focus:         tag.replace(/-/g, ' '),
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function discoverPublications(
  query: string,
  existingDomains: Set<string>,
): Promise<DiscoveredPublication[]> {
  const [feedly, substack, medium] = await Promise.allSettled([
    queryFeedly(query),
    querySubstack(query),
    queryMedium(query),
  ]);

  const all: DiscoveredPublication[] = [
    ...(feedly.status  === 'fulfilled' ? feedly.value  : []),
    ...(substack.status === 'fulfilled' ? substack.value : []),
    ...(medium.status  === 'fulfilled' ? medium.value  : []),
  ];

  // Deduplicate by domain (Medium tags share one, so by URL there), filter already-tracked
  const seen = new Set<string>();
  return all.filter(p => {
    const domain = extractDomain(p.url);
    if (existingDomains.has(domain)) return false;
    const key = p.source === 'medium' ? p.url : domain;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
