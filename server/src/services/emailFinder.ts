/**
 * emailFinder.ts
 * Fetches common author/about/staff pages on a publication's website to find
 * a journalist's publicly listed email and role title.
 * Only reads pages publications make public — no guessing private details.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const EMAIL_BLOCKLIST = [
  'example.com', 'sentry.io', 'wixpress.com', 'w3.org', 'schema.org',
  'wordpress.org', 'gravatar.com', 'google.com', 'facebook.com',
];

function isValidEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return !EMAIL_BLOCKLIST.some(d => lower.endsWith(`@${d}`));
}

function extractEmailsFromHtml(html: string, domain: string): string[] {
  const $ = cheerio.load(html);
  $('script[src], style, noscript').remove();

  const text = $.root().text();
  const fromText = (text.match(EMAIL_RE) || []);

  const fromMailto: string[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const addr = href.replace(/^mailto:/i, '').split('?')[0].trim();
    if (addr) fromMailto.push(addr);
  });

  const all = [...new Set([...fromMailto, ...fromText])];
  return all.filter(isValidEmail);
}


function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function deriveDomain(pubUrl: string): string {
  try {
    return new URL(pubUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Returns html string, 'blocked' if Cloudflare 403, or null if truly not found
async function tryFetch(url: string): Promise<string | 'blocked' | null> {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 3,
    });
    return typeof res.data === 'string' ? res.data : null;
  } catch (err: any) {
    // 403 from Cloudflare means the page exists but blocks bots — still useful as a contactUrl
    if (err.response?.status === 403) return 'blocked';
    return null;
  }
}

export interface EmailFinderResult {
  email: string;
  contactUrl: string;
}

export async function findJournalistEmail(
  name: string,
  pubUrl: string,
): Promise<EmailFinderResult | null> {
  if (!pubUrl) return null;

  const base = pubUrl.replace(/\/$/, '');
  const domain = deriveDomain(pubUrl);
  const slug = nameToSlug(name);

  const candidates = [
    `${base}/author/${slug}`,
    `${base}/authors/${slug}`,
    `${base}/staff/${slug}`,
    `${base}/people/${slug}`,
    `${base}/contributors/${slug}`,
    `${base}/writer/${slug}`,
    `${base}/reporter/${slug}`,
    `${base}/profile/${slug}`,
    `${base}/about/${slug}`,
    `${base}/team/${slug}`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/contact`,
    `${base}/contact-us`,
  ];

  let fallbackContactUrl = ''; // best URL we found even if blocked

  for (const url of candidates) {
    const result = await tryFetch(url);

    if (result === 'blocked') {
      // Page exists but Cloudflare blocked us — save URL so user can visit manually
      if (!fallbackContactUrl) fallbackContactUrl = url;
      continue;
    }
    if (!result) continue;

    const emails = extractEmailsFromHtml(result, domain);
    const ownDomainEmail = emails.find(e => e.toLowerCase().endsWith(`@${domain}`));
    const bestEmail = ownDomainEmail || emails[0] || '';

    if (bestEmail || url.includes(slug)) {
      return { email: bestEmail, contactUrl: url };
    }
  }

  // Nothing scraped, but we found a blocked page that's worth linking to
  if (fallbackContactUrl) {
    return { email: '', contactUrl: fallbackContactUrl };
  }

  return null;
}
