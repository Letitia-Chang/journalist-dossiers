/**
 * One-off script: re-runs SerpAPI for journalists missing followerCount
 * and saves the detected count + auto-fills socialFollowing if blank.
 *
 * Run from /server:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfillFollowerCount.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

import pool from '../src/db';
import { initDb } from '../src/db';

function parseFollowerCount(raw: string): number {
  const clean = raw.replace(/,/g, '').trim();
  const m = clean.match(/^([\d.]+)([KkMm]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2].toLowerCase() === 'k') return Math.round(n * 1_000);
  if (m[2].toLowerCase() === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

function extractFollowerCount(serpData: any): number | null {
  const results: { snippet?: string }[] = serpData?.organic_results || [];
  let best = 0;
  for (const result of results) {
    const snippet = result.snippet || '';
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

async function main() {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) { console.error('SERP_API_KEY not set'); process.exit(1); }

  await initDb();

  const journalists = (await pool.query(`
    SELECT id, name, publication, "socialFollowing"
    FROM journalists
    WHERE "followerCount" IS NULL
    ORDER BY "totalScore" DESC
  `)).rows;

  console.log(`Found ${journalists.length} journalists without followerCount`);

  let found = 0;
  for (const j of journalists) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await axios.get('https://serpapi.com/search.json', {
        params: { q: `"${j.name}" "${j.publication}"`, api_key: apiKey, num: 10 },
        timeout: 15_000,
      });

      const followerCount = extractFollowerCount(r.data);
      if (!followerCount) {
        console.log(`  ${j.name} — no follower count found in snippets`);
        continue;
      }

      const updates: string[] = ['"followerCount" = $1'];
      const values: any[] = [followerCount];
      let i = 2;

      if (!j.socialFollowing) {
        updates.push(`"socialFollowing" = $${i++}`);
        values.push(`~${formatFollowerCount(followerCount)} (from search snippets)`);
      }

      values.push(j.id);
      await pool.query(
        `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
        values
      );

      console.log(`  ✓ ${j.name} → ${formatFollowerCount(followerCount)} followers${!j.socialFollowing ? ' (also set socialFollowing)' : ''}`);
      found++;
    } catch (err: any) {
      console.error(`  ✗ ${j.name}: ${err.message}`);
    }
  }

  console.log(`\nDone. Found follower counts for ${found}/${journalists.length} journalists.`);
  await pool.end();
}

main().catch(console.error);
