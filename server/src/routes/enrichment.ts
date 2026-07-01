import { Router } from 'express';
import axios from 'axios';
import pool from '../db';

const router = Router();

// GET /api/enrichment/credits
router.get('/credits', async (_req, res) => {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY not set' });
  try {
    const r = await axios.get('https://api.apollo.io/api/v1/auth/health', {
      headers: { 'x-api-key': apiKey },
    });
    const { credits_used, credits_limit, credits_remaining } = r.data;
    res.json({ credits_used, credits_limit, credits_remaining });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch { return url; }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// POST /api/enrichment/:id
router.post('/:id', async (req, res) => {
  try {
    const journalistId = Number(req.params.id);
    const journalist = (await pool.query(`
      SELECT j.id, j.name, j.email, j.publication, p.url as "pubUrl"
      FROM journalists j
      LEFT JOIN publications p ON p.name = j.publication
      WHERE j.id = $1
    `, [journalistId])).rows[0];

    if (!journalist) return res.status(404).json({ error: 'Journalist not found' });

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY not set in environment' });

    const { firstName, lastName } = splitName(journalist.name);
    const domain = journalist.pubUrl ? extractDomain(journalist.pubUrl) : '';

    let apolloRes: any;
    try {
      apolloRes = await axios.post(
        'https://api.apollo.io/v1/people/match',
        {
          api_key: apiKey,
          first_name: firstName, last_name: lastName,
          organization_name: journalist.publication,
          ...(domain ? { domain } : {}),
          reveal_personal_emails: false,
        },
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, timeout: 15_000 }
      );
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      if (status === 422) return res.status(404).json({ error: 'Apollo could not find a match for this journalist.' });
      if (status === 401 || status === 403) return res.status(500).json({ error: 'Apollo API key is invalid or has no remaining credits.' });
      return res.status(502).json({ error: `Apollo API error: ${msg}` });
    }

    const person = apolloRes.data?.person;
    if (!person) return res.status(404).json({ error: 'No match found in Apollo for this journalist.' });

    const email: string | null = person.email || null;
    const emailStatus: string = person.email_status || 'unknown';
    const linkedinUrl: string | null = person.linkedin_url || null;
    const twitterUrl: string | null = person.twitter_url || null;
    const title: string | null = person.title || null;

    if (email && !journalist.email) {
      await pool.query('UPDATE journalists SET email = $1, "updatedAt" = NOW() WHERE id = $2', [email, journalistId]);
    }

    return res.json({ found: true, email, emailStatus, linkedinUrl, twitterUrl, title, saved: !!(email && !journalist.email) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/enrichment/bulk/run
router.post('/bulk/run', async (req, res) => {
  try {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY not set in environment' });

    const missing = (await pool.query(`
      SELECT j.id, j.name, j.email, j.publication, p.url as "pubUrl"
      FROM journalists j
      LEFT JOIN publications p ON p.name = j.publication
      WHERE (j.email IS NULL OR j.email = '')
        AND j."outreachStatus" NOT IN ('Not a Fit', 'Declined')
    `)).rows;

    if (missing.length === 0) return res.json({ message: 'All journalists already have emails.', count: 0 });

    res.json({ message: `Enriching ${missing.length} journalists in the background…`, count: missing.length });

    (async () => {
      let found = 0;
      for (const j of missing) {
        await new Promise(r => setTimeout(r, 1200));
        const { firstName, lastName } = splitName(j.name);
        const domain = j.pubUrl ? extractDomain(j.pubUrl) : '';
        try {
          const r = await axios.post(
            'https://api.apollo.io/v1/people/match',
            {
              api_key: apiKey,
              first_name: firstName, last_name: lastName,
              organization_name: j.publication,
              ...(domain ? { domain } : {}),
              reveal_personal_emails: false,
            },
            { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, timeout: 15_000 }
          );
          const email = r.data?.person?.email;
          if (email) {
            await pool.query('UPDATE journalists SET email = $1, "updatedAt" = NOW() WHERE id = $2', [email, j.id]);
            found++;
          }
        } catch (err: any) {
          console.error(`[Apollo Bulk] Error for ${j.name}:`, err.response?.data?.message || err.message);
        }
      }
      console.log(`[Apollo Bulk] Done. Found ${found}/${missing.length} emails.`);
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/enrichment/:id/profiles — find LinkedIn, MuckRack, Twitter via SerpAPI
router.post('/:id/profiles', async (req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });

  const journalist = (await pool.query(
    'SELECT id, name, publication FROM journalists WHERE id = $1', [req.params.id]
  )).rows[0];
  if (!journalist) return res.status(404).json({ error: 'Not found' });

  const query = `"${journalist.name}" "${journalist.publication}"`;
  try {
    const r = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, api_key: apiKey, num: 10 },
      timeout: 15_000,
    });

    const results: { link: string }[] = r.data?.organic_results || [];
    let linkedinUrl = '', muckrackUrl = '', twitterUrl = '';

    for (const result of results) {
      const url = result.link || '';
      if (!linkedinUrl && /linkedin\.com\/in\//.test(url)) linkedinUrl = url;
      if (!muckrackUrl && /muckrack\.com\//.test(url)) muckrackUrl = url;
      if (!twitterUrl && /(?:twitter|x)\.com\/[^/]+$/.test(url)) twitterUrl = url;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (linkedinUrl) { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
    if (muckrackUrl) { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
    if (twitterUrl)  { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }

    if (updates.length > 0) {
      values.push(journalist.id);
      await pool.query(
        `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
        values
      );
    }

    res.json({ linkedinUrl, muckrackUrl, twitterUrl, saved: updates.length > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

// POST /api/enrichment/bulk/profiles — find profiles for all journalists missing them
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
        const results: { link: string }[] = r.data?.organic_results || [];
        let linkedinUrl = '', muckrackUrl = '', twitterUrl = '';
        for (const result of results) {
          const url = result.link || '';
          if (!linkedinUrl && /linkedin\.com\/in\//.test(url)) linkedinUrl = url;
          if (!muckrackUrl && /muckrack\.com\//.test(url)) muckrackUrl = url;
          if (!twitterUrl && /(?:twitter|x)\.com\/[^/]+$/.test(url)) twitterUrl = url;
        }
        const updates: string[] = [];
        const values: any[] = [];
        let i = 1;
        if (linkedinUrl) { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
        if (muckrackUrl) { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
        if (twitterUrl)  { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }
        if (updates.length > 0) {
          values.push(j.id);
          await pool.query(
            `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
            values
          );
          found++;
          console.log(`[SerpAPI] ${j.name} → linkedin:${!!linkedinUrl} muckrack:${!!muckrackUrl} twitter:${!!twitterUrl}`);
        }
      } catch (err: any) {
        console.error(`[SerpAPI] Error for ${j.name}:`, err.message);
      }
    }
    console.log(`[SerpAPI Bulk] Done. Found profiles for ${found}/${missing.length} journalists.`);
  })();
});

export default router;
