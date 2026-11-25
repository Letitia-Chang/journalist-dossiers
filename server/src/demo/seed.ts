import crypto from 'crypto';
import type { PoolClient } from 'pg';
import pool from '../db';
import { saveProfile } from '../lib/companyProfile';
import { DEFAULT_DIMENSIONS } from '../lib/bootstrap';
import {
  DEMO_CAMPAIGN, DEMO_COVERAGE, DEMO_JOURNALISTS, DEMO_OUTLETS, DEMO_PROFILE, LEGACY_DEMO_ORG_ID,
} from './seedData';
import type { AngleKey, DemoJournalist } from './seedData';

// ── Text generated from the dataset (rationales and pitch drafts) ─────────────

function bucket(score: number, weight: number): 'high' | 'mid' | 'low' {
  const r = score / weight;
  return r >= 0.75 ? 'high' : r >= 0.45 ? 'mid' : 'low';
}

export function rationaleFor(dim: number, j: DemoJournalist, outletName: string, score: number, weight: number): string {
  const b = bucket(score, weight);
  const a1 = j.articles[0]?.title ?? '';
  const a2 = j.articles[1]?.title ?? a1;
  switch (dim) {
    case 0: return b === 'high' ? `Covers ${j.beatPhrase}, squarely our space; see “${a1}”.`
      : b === 'mid' ? `Adjacent beat (${j.beatPhrase}) that touches grid topics, e.g. “${a1}”.`
      : `Beat (${j.beatPhrase}) rarely intersects with grid software.`;
    case 1: return b === 'high' ? `${outletName} readers are utility, developer and investor professionals.`
      : b === 'mid' ? `${outletName} reaches part of our audience, mixed with general readers.`
      : `${outletName}'s readers are mostly outside our target audience.`;
    case 2: return b === 'high' ? `Recently covered the queue problem or a comparable company: “${a2}”.`
      : b === 'mid' ? `Some related coverage (“${a2}”), but not about companies like ours.`
      : 'No recent coverage of similar companies or topics.';
    case 3: return b === 'high' ? `Covers the whole US, including our core markets (${j.region}).`
      : b === 'mid' ? `Coverage area (${j.region}) overlaps part of our footprint.`
      : `Coverage area (${j.region}) only partly overlaps our markets.`;
    case 4: return b === 'high' ? `${outletName} is a widely read outlet.`
      : b === 'mid' ? `${outletName} has a solid specialist audience.`
      : `${outletName} has a small audience.`;
    default: return b === 'high' ? 'Publishes a direct contact route and is active on their beat.'
      : b === 'mid' ? 'Contact route is public; unclear how often they respond to pitches.'
      : 'No public contact route found.';
  }
}

function evidenceFor(dim: number, j: DemoJournalist, score: number, weight: number): string[] {
  const urls = j.articles.map(a => articleUrl(j, a.slug));
  if (bucket(score, weight) === 'low') return [];
  if (dim === 0) return urls.slice(0, 1);
  if (dim === 2) return urls.slice(1, 2).length ? urls.slice(1, 2) : urls.slice(0, 1);
  return [];
}

function articleUrl(j: DemoJournalist, slug: string): string {
  const outlet = DEMO_OUTLETS.find(o => o.key === j.outlet)!;
  return `${outlet.url}/2026/${slug}`;
}

const ANGLE: Record<AngleKey, { subject: string; spokesperson: number; body: (who: string) => string }> = {
  queue: { subject: 'Queue waits hit 4.8 years: new data', spokesperson: 0, body: who =>
    `${who} at Lumen Grid has been tracking exactly this. In our State of the Queue analysis of 2,100 projects, the median interconnection wait rose from 2.1 to 4.8 years in a decade.` },
  utility: { subject: 'Clearing study backlogs without more staff', spokesperson: 2, body: () =>
    'Many utilities are buried in study backlogs. Our Utility Console helps interconnection teams clear them about 3x faster using better data, not more staff.' },
  finance: { subject: 'Lumen Grid raises $12M for grid transparency', spokesperson: 0, body: who =>
    `We have just closed a $12M Series A led by Fictional Ventures to bring queue transparency to five more grid regions. Unpredictable interconnection timelines are one of the biggest risks developers and their financiers carry, and ${who} can explain how we price it.` },
  research: { subject: 'New data: 2,100 projects, 4.8-year median wait', spokesperson: 0, body: who =>
    `We have just published State of the Queue: across 2,100 projects, median waits rose from 2.1 to 4.8 years, and network-upgrade costs are the least predictable part. ${who} can walk you through the data.` },
  data: { subject: 'The model behind QueueScope', spokesperson: 1, body: who =>
    `${who} built the forecasting model behind QueueScope, which predicts study timelines from public queue data and flags the upgrades blocking each project. Happy to share the methodology.` },
  rural: { subject: 'Why small utilities feel the backlog most', spokesperson: 2, body: () =>
    'Small utilities and co-ops feel the study backlog hardest because they have few engineers. Our head of policy, Ines Calloway, can explain how better data helps them without adding staff.' },
  consumer: { subject: 'Why home solar waits on the grid', spokesperson: 0, body: who =>
    `This is a stretch from your beat, but if you ever cover why home solar and batteries wait months to connect, ${who} can explain the interconnection queue in plain terms.` },
};

export function draftFor(j: DemoJournalist): { subject: string; body: string } {
  const angle = ANGLE[j.angle];
  const sp = DEMO_PROFILE.spokespeople[angle.spokesperson];
  const who = `${sp.name} (${sp.title})`;
  const first = j.name.split(' ')[0];
  return {
    subject: angle.subject,
    body: `Hi ${first},\n\n${j.hook}\n\n${angle.body(who)}\n\nWould a short call this week be useful?\n\n${DEMO_PROFILE.email_signature}`,
  };
}

// ── Sandboxes ─────────────────────────────────────────────────────────────────

export const sandboxHours = () => {
  const n = Number(process.env.DEMO_SANDBOX_HOURS ?? 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
};
/** Live sandboxes kept at once. With the write limits below, this is what bounds the database size. */
export const MAX_SANDBOXES = 300;
/** A sandbox younger than this is never dropped to make room, so a flood can't sign out active visitors. */
export const PROTECTED_MINUTES = 60;

async function insertRows(db: PoolClient, table: string, columns: string[], rows: unknown[][]): Promise<number[]> {
  if (rows.length === 0) return [];
  const values = rows.map((r, i) => `(${r.map((_v, k) => `$${i * columns.length + k + 1}`).join(', ')})`).join(', ');
  const res = await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values} RETURNING id`, rows.flat());
  return res.rows.map(r => r.id);
}

/**
 * Create a private copy of the fictional company for one visitor, so nothing a visitor does is
 * visible to anyone else. Every query in the app is already scoped by organization.
 */
export async function createSandbox(): Promise<{ user: { id: string; email: string; name: string; role: string }; org: { id: string; name: string; slug: string } }> {
  const tag = crypto.randomBytes(9).toString('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [org] } = await db.query(
      `INSERT INTO organizations (name, slug, demo_expires_at) VALUES ($1, $2, NOW() + make_interval(hours => $3)) RETURNING id, name, slug`,
      [DEMO_PROFILE.name, `demo-${tag}`, Math.ceil(sandboxHours())],
    );
    await saveProfile(org.id, DEMO_PROFILE, db);
    // A member, so visitors can explore and run analyses but not change settings or run discovery.
    // '!' is not a bcrypt hash, so this account can never be signed in to with a password.
    const { rows: [user] } = await db.query(
      `INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, '!', 'Demo Visitor', 'member') RETURNING id, email, name, role`,
      [org.id, `visitor-${tag}@demo.example.com`],
    );

    const dimIds = await insertRows(db, 'scoring_dimensions', ['org_id', 'name', 'description', 'weight', 'display_order'],
      DEFAULT_DIMENSIONS.map((d, i) => [org.id, d.name, d.description, d.weight, i]));
    const outletIds = await insertRows(db, 'publications', ['org_id', 'name', 'url', 'tier', 'focus'],
      DEMO_OUTLETS.map(o => [org.id, o.name, o.url, o.tier, o.focus]));
    const outletIndex = (key: string) => DEMO_OUTLETS.findIndex(o => o.key === key);
    const [campaignId] = await insertRows(db, 'campaigns', ['org_id', 'name', 'brief', 'campaign_type', 'status'],
      [[org.id, DEMO_CAMPAIGN.name, DEMO_CAMPAIGN.brief, DEMO_CAMPAIGN.type, 'active']]);
    await insertRows(db, 'campaign_type_styles', ['org_id', 'campaign_type', 'instructions'],
      [[org.id, DEMO_CAMPAIGN.type, DEMO_CAMPAIGN.styleInstructions]]);
    const jIds = await insertRows(db, 'journalists', ['org_id', 'publication_id', 'name', 'email', 'bio', 'beats', 'total_score'],
      DEMO_JOURNALISTS.map(j => [org.id, outletIds[outletIndex(j.outlet)], j.name, j.email, j.bio, j.beats, j.scores.reduce((a, b) => a + b, 0)]));

    const articles: unknown[][] = [];
    const scores: unknown[][] = [];
    const drafts: unknown[][] = [];
    const logs: unknown[][] = [];
    let coverageJournalistId: number | null = null;
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    DEMO_JOURNALISTS.forEach((j, n) => {
      const id = jIds[n];
      const outlet = DEMO_OUTLETS[outletIndex(j.outlet)];
      for (const a of j.articles) articles.push([org.id, id, a.title, articleUrl(j, a.slug), a.date]);
      dimIds.forEach((dimId, i) => {
        const weight = DEFAULT_DIMENSIONS[i].weight;
        scores.push([org.id, id, dimId, j.scores[i], rationaleFor(i, j, outlet.name, j.scores[i], weight), JSON.stringify(evidenceFor(i, j, j.scores[i], weight))]);
      });
      const draft = draftFor(j);
      const history: [string, string, number][] = j.outreach === 'Covered'
        ? [['pitch', 'Pitched', 20], ['response', 'Responded', 14], ['note', 'Covered', 5]]
        : j.outreach === 'Responded' ? [['pitch', 'Pitched', 14], ['response', 'Responded', 10]]
        : j.outreach === 'Pitched' ? [['pitch', 'Pitched', 7]] : [];
      drafts.push([org.id, campaignId, id, draft.subject, draft.body, j.outreach ? 'sent' : 'ready', history.length ? daysAgo(history[0][2]) : null]);
      for (const [type, status, ago] of history) logs.push([org.id, id, campaignId, user.id, type, status, draft.subject, daysAgo(ago)]);
      if (j.outreach === 'Covered') coverageJournalistId = id;
    });

    await insertRows(db, 'articles', ['org_id', 'journalist_id', 'title', 'url', 'published_at'], articles);
    await insertRows(db, 'journalist_scores', ['org_id', 'journalist_id', 'dimension_id', 'score', 'rationale', 'evidence'], scores);
    await insertRows(db, 'campaign_journalists', ['org_id', 'campaign_id', 'journalist_id', 'draft_subject', 'draft_body', 'status', 'sent_at'], drafts);
    await insertRows(db, 'outreach_logs', ['org_id', 'journalist_id', 'campaign_id', 'logged_by', 'type', 'status', 'notes', 'logged_at'], logs);
    await insertRows(db, 'coverage', ['org_id', 'campaign_id', 'journalist_id', 'title', 'url', 'notes', 'published_at'],
      [[org.id, campaignId, coverageJournalistId, DEMO_COVERAGE.title, DEMO_COVERAGE.url, DEMO_COVERAGE.notes, daysAgo(5)]]);

    await db.query('COMMIT');
    return { user, org };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Drop expired sandboxes. Never touches a real organization. */
export async function sweepSandboxes(): Promise<void> {
  await pool.query('DELETE FROM organizations WHERE demo_expires_at < NOW()');
}

/** Make room for one more sandbox by dropping the oldest unprotected ones. False when the demo is full. */
export async function makeRoomForSandbox(): Promise<boolean> {
  await sweepSandboxes();
  await pool.query(
    `DELETE FROM organizations WHERE demo_expires_at IS NOT NULL AND created_at < NOW() - make_interval(mins => $2)
       AND id IN (SELECT id FROM organizations WHERE demo_expires_at IS NOT NULL ORDER BY created_at DESC OFFSET $1)`,
    [MAX_SANDBOXES - 1, PROTECTED_MINUTES],
  );
  const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int AS c FROM organizations WHERE demo_expires_at IS NOT NULL');
  return c < MAX_SANDBOXES;
}

/**
 * Run on boot in demo mode. Refuses a database that holds a real organization, so DEMO_MODE can
 * never expose or mix with real data. Existing sandboxes survive, so a restart doesn't sign
 * visitors out.
 */
export async function prepareDemo(): Promise<void> {
  // Before sandboxes, every visitor shared one organization. It is only ours to delete if its sole
  // user is the old demo visitor: anyone else means it was put to real use.
  const legacyDemo = `o.id = $1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id AND u.email <> 'demo@example.com')`;
  const { rows } = await pool.query(`SELECT o.id FROM organizations o WHERE o.demo_expires_at IS NULL AND NOT (${legacyDemo}) LIMIT 1`, [LEGACY_DEMO_ORG_ID]);
  if (rows.length > 0) throw new Error('DEMO_MODE refuses to run on a database that contains a real organization.');
  await pool.query(`DELETE FROM organizations o WHERE ${legacyDemo}`, [LEGACY_DEMO_ORG_ID]);
  await sweepSandboxes();
}

/** `npm run demo:reset`: drop every sandbox. */
export async function resetDemo(): Promise<void> {
  await prepareDemo();
  await deleteAllSandboxes();
}

export async function deleteAllSandboxes(): Promise<void> {
  await pool.query('DELETE FROM organizations WHERE demo_expires_at IS NOT NULL');
}
