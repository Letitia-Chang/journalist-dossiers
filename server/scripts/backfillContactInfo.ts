/**
 * One-time backfill: fills photoUrl (via SerpAPI image search) for all existing
 * journalists missing them. Email scraping is skipped for sites behind Cloudflare.
 *
 * Run from /server:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfillContactInfo.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import axios from 'axios';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SERP_API_KEY = process.env.SERP_API_KEY!;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Prefer photos from known good sources, ranked
const PHOTO_SOURCE_PRIORITY = [
  /muckrack\.com/,
  /gravatar\.com/,
  /linkedin\.com/,
  /twimg\.com/,
];

function pickBestPhoto(images: { original?: string; thumbnail?: string }[]): string {
  for (const pattern of PHOTO_SOURCE_PRIORITY) {
    const match = images.find(img => img.original && pattern.test(img.original));
    if (match?.original) return match.original;
  }
  // Fall back to first result with an original URL
  return images.find(img => img.original)?.original || '';
}

async function fetchPhoto(name: string, publication: string): Promise<string> {
  const r = await axios.get('https://serpapi.com/search.json', {
    params: {
      q: `"${name}" ${publication} journalist`,
      api_key: SERP_API_KEY,
      tbm: 'isch',
      num: 10,
    },
    timeout: 15_000,
  });
  const images: { original?: string; thumbnail?: string }[] = r.data.images_results || [];
  return pickBestPhoto(images);
}

async function main() {
  const { rows: journalists } = await pool.query(`
    SELECT id, name, publication, "photoUrl"
    FROM journalists
    WHERE "photoUrl" IS NULL OR "photoUrl" = ''
    ORDER BY id
  `);

  console.log(`Found ${journalists.length} journalists missing a photo.\n`);

  for (const j of journalists) {
    console.log(`→ ${j.name} @ ${j.publication}`);
    await sleep(1200);

    try {
      const photo = await fetchPhoto(j.name, j.publication);
      if (photo) {
        await pool.query(
          `UPDATE journalists SET "photoUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
          [photo, j.id]
        );
        console.log(`   ✓ photo: ${photo.slice(0, 80)}`);
      } else {
        console.log(`   – no photo found`);
      }
    } catch (err: any) {
      console.log(`   ✗ error: ${err.message}`);
    }
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
