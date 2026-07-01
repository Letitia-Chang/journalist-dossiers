import { Router } from 'express';
import axios from 'axios';
import pool from '../db';
import { analyzeJournalist } from '../services/journalistAnalysis';

async function rescoreInBackground(journalistId: number) {
  try {
    const j = (await pool.query('SELECT * FROM journalists WHERE id = $1', [journalistId])).rows[0];
    if (!j) return;
    const pub = (await pool.query('SELECT tier FROM publications WHERE LOWER(name) = LOWER($1)', [j.publication])).rows[0];
    const articleRows = (await pool.query(
      'SELECT title, url FROM articles WHERE "journalistId" = $1 ORDER BY "publishDate" DESC LIMIT 10', [journalistId]
    )).rows;
    let articleTitle = ''; let articleUrl = '';
    const noteMatch = (j.notes || '').match(/Recent article: (.+?) — (https?:\/\/\S+)/);
    if (noteMatch) { articleTitle = noteMatch[1]; articleUrl = noteMatch[2]; }
    if (articleRows.length > 0) { articleTitle = articleRows[0].title; articleUrl = articleRows[0].url; }

    const analysis = await analyzeJournalist({
      name: j.name, publication: j.publication || '', publicationTier: pub?.tier || 'B',
      recentArticleTitle: articleTitle, recentArticleUrl: articleUrl, suggestedBeat: j.beat || '',
      allArticleTitles: articleRows.map((a: any) => a.title),
      socialFollowing: j.socialFollowing || '',
      followerCount: j.followerCount,
    });
    if (!analysis) return;
    const total = Object.values(analysis.scores).reduce((s: number, v) => s + (v as number), 0);
    const tier = total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;
    await pool.query(`
      UPDATE journalists SET
        "bestPitchAngle"=$1, "aiRelevanceScore"=$2, "startupRelevanceScore"=$3,
        "northStarFitScore"=$4, "publicationAuthorityScore"=$5,
        "audienceReachScore"=$6, "contactabilityScore"=$7,
        "totalScore"=$8, "priorityTier"=$9, "updatedAt"=NOW()
      WHERE id=$10
    `, [analysis.bestPitchAngle, analysis.scores.aiRelevanceScore, analysis.scores.startupRelevanceScore,
        analysis.scores.northStarFitScore, analysis.scores.publicationAuthorityScore,
        analysis.scores.audienceReachScore, analysis.scores.contactabilityScore, total, tier, journalistId]);
    console.log(`[SerpAPI] Auto-rescored ${j.name} after follower count update → score ${total}`);
  } catch (err: any) {
    console.error(`[SerpAPI] Auto-rescore failed for id ${journalistId}:`, err.message);
  }
}

const router = Router();

// GET /api/enrichment/credits — SerpAPI remaining searches
router.get('/credits', async (_req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });
  try {
    const r = await axios.get('https://serpapi.com/account', { params: { api_key: apiKey } });
    const { plan_searches_left, total_searches_done, plan_monthly_searches } = r.data;
    res.json({ searches_left: plan_searches_left, searches_done: total_searches_done, searches_limit: plan_monthly_searches });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

const AUTHOR_PAGE_RE = /\/(about[-_]?us?|author|authors|staff|people|team|contributors?|bio|profile|journalist|reporter|writer|columnist)\b/i;

// Parse a follower count string like "3K", "25.3K", "1.2M", "12,345" → number
function parseFollowerCount(raw: string): number {
  const clean = raw.replace(/,/g, '').trim();
  const m = clean.match(/^([\d.]+)([KkMm]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2].toLowerCase() === 'k') return Math.round(n * 1_000);
  if (m[2].toLowerCase() === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

// Extract the largest follower count mentioned across all organic snippets
function extractFollowerCount(serpData: any): number | null {
  const results: { snippet?: string; link?: string }[] = serpData?.organic_results || [];
  let best = 0;

  for (const result of results) {
    const snippet = result.snippet || '';
    // Match patterns like "3K followers", "25,300 Followers", "1.2M followers"
    const matches = snippet.matchAll(/([\d,]+\.?\d*[KkMm]?)\s+[Ff]ollowers/g);
    for (const m of matches) {
      const count = parseFollowerCount(m[1]);
      if (count > best) best = count;
    }
  }

  return best > 0 ? best : null;
}

function formatFollowerCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function extractProfiles(serpData: any, publicationName: string) {
  const results: { link: string; thumbnail?: string }[] = serpData?.organic_results || [];
  let linkedinUrl = '', muckrackUrl = '', twitterUrl = '', contactUrl = '', photoUrl = '';

  photoUrl = serpData?.knowledge_graph?.thumbnail || '';

  const pubKeyword = publicationName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const result of results) {
    const url = result.link || '';
    if (!linkedinUrl && /linkedin\.com\/in\//.test(url)) linkedinUrl = url;
    if (!muckrackUrl && /muckrack\.com\//.test(url)) muckrackUrl = url;
    if (!twitterUrl && /(?:twitter|x)\.com\/[^/]+$/.test(url)) twitterUrl = url;
    if (!contactUrl && pubKeyword && url.toLowerCase().includes(pubKeyword) && AUTHOR_PAGE_RE.test(url)) {
      contactUrl = url;
    }
    if (!photoUrl && result.thumbnail) photoUrl = result.thumbnail;
  }

  const followerCount = extractFollowerCount(serpData);

  return { linkedinUrl, muckrackUrl, twitterUrl, contactUrl, photoUrl, followerCount };
}

// POST /api/enrichment/bulk/profiles — must be BEFORE /:id/profiles
router.post('/bulk/profiles', async (_req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });

  const missing = (await pool.query(`
    SELECT id, name, publication FROM journalists
    WHERE ("linkedinUrl" IS NULL OR "linkedinUrl" = '')
      AND ("muckRackUrl" IS NULL OR "muckRackUrl" = '')
  `)).rows;

  if (missing.length === 0) return res.json({ message: 'All journalists already have profiles.', count: 0 });

  res.json({ message: `Finding profiles for ${missing.length} journalists in the background…`, count: missing.length });

  (async () => {
    let found = 0;
    for (const j of missing) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await axios.get('https://serpapi.com/search.json', {
          params: { q: `"${j.name}" "${j.publication}"`, api_key: apiKey, num: 10 },
          timeout: 15_000,
        });
        const { linkedinUrl, muckrackUrl, twitterUrl, contactUrl, photoUrl, followerCount } = extractProfiles(r.data, j.publication);
        const updates: string[] = [];
        const values: any[] = [];
        let i = 1;
        if (linkedinUrl)    { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
        if (muckrackUrl)    { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
        if (twitterUrl)     { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }
        if (contactUrl)     { updates.push(`"contactUrl"  = $${i++}`); values.push(contactUrl); }
        if (photoUrl)       { updates.push(`"photoUrl"    = $${i++}`); values.push(photoUrl); }
        if (followerCount)  { updates.push(`"followerCount" = $${i++}`); values.push(followerCount); }
        if (followerCount && !j.socialFollowing) {
          updates.push(`"socialFollowing" = $${i++}`);
          values.push(`~${formatFollowerCount(followerCount)} (from search snippets)`);
        }
        updates.push(`"serpSearchedAt" = NOW()`);
        values.push(j.id);
        await pool.query(
          `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
          values
        );
        if (followerCount) {
          setTimeout(() => rescoreInBackground(j.id), 2000);
        }
        if (linkedinUrl || muckrackUrl || twitterUrl || contactUrl || photoUrl || followerCount) {
          found++;
          console.log(`[SerpAPI] ${j.name} → linkedin:${!!linkedinUrl} muckrack:${!!muckrackUrl} followers:${followerCount ?? 'n/a'}`);
        }
      } catch (err: any) {
        console.error(`[SerpAPI] Error for ${j.name}:`, err.message);
      }
    }
    console.log(`[SerpAPI Bulk] Done. Found profiles for ${found}/${missing.length} journalists.`);
  })();
});

// POST /api/enrichment/:id/profiles — find LinkedIn, MuckRack, Twitter, author page via SerpAPI
router.post('/:id/profiles', async (req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });

  const journalist = (await pool.query(
    'SELECT id, name, publication, "socialFollowing" FROM journalists WHERE id = $1', [req.params.id]
  )).rows[0];
  if (!journalist) return res.status(404).json({ error: 'Not found' });

  try {
    const r = await axios.get('https://serpapi.com/search.json', {
      params: { q: `"${journalist.name}" "${journalist.publication}"`, api_key: apiKey, num: 10 },
      timeout: 15_000,
    });

    const { linkedinUrl, muckrackUrl, twitterUrl, contactUrl, photoUrl, followerCount } = extractProfiles(r.data, journalist.publication);

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (linkedinUrl)   { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
    if (muckrackUrl)   { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
    if (twitterUrl)    { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }
    if (contactUrl)    { updates.push(`"contactUrl"  = $${i++}`); values.push(contactUrl); }
    if (photoUrl)      { updates.push(`"photoUrl"    = $${i++}`); values.push(photoUrl); }
    if (followerCount) { updates.push(`"followerCount" = $${i++}`); values.push(followerCount); }
    if (followerCount && !journalist.socialFollowing) {
      updates.push(`"socialFollowing" = $${i++}`);
      values.push(`~${formatFollowerCount(followerCount)} (from search snippets)`);
    }

    // Always stamp serpSearchedAt regardless of whether profiles were found
    updates.push(`"serpSearchedAt" = NOW()`);
    values.push(journalist.id);
    await pool.query(
      `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
      values
    );

    if (followerCount) {
      setTimeout(() => rescoreInBackground(journalist.id), 2000);
    }
    res.json({ linkedinUrl, muckrackUrl, twitterUrl, contactUrl, photoUrl, followerCount, saved: !!(linkedinUrl || muckrackUrl || twitterUrl || contactUrl || photoUrl || followerCount) });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

export default router;
