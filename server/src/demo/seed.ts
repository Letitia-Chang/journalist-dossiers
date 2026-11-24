import crypto from 'crypto';
import bcrypt from 'bcrypt';
import pool from '../db';
import { saveProfile } from '../lib/companyProfile';
import { DEFAULT_DIMENSIONS } from '../lib/bootstrap';
import {
  DEMO_CAMPAIGN, DEMO_COVERAGE, DEMO_JOURNALISTS, DEMO_ORG_ID, DEMO_OUTLETS, DEMO_PROFILE,
  DEMO_USER_EMAIL, DEMO_USER_ID,
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

// ── Reset and seed ────────────────────────────────────────────────────────────

/**
 * Wipe the demo organization and rebuild it from the fictional dataset. Fixed IDs keep any
 * browser session issued before a reseed valid. Refuses to run if the database holds any
 * other organization, so DEMO_MODE can never wipe real data.
 */
export async function resetAndSeedDemo(): Promise<void> {
  const { rows: others } = await pool.query('SELECT id FROM organizations WHERE id <> $1 LIMIT 1', [DEMO_ORG_ID]);
  if (others.length > 0) {
    throw new Error('DEMO_MODE refuses to wipe a database that contains a non-demo organization.');
  }

  await pool.query('DELETE FROM organizations WHERE id = $1', [DEMO_ORG_ID]); // cascades to everything
  await pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, 'lumen-grid')`, [DEMO_ORG_ID, DEMO_PROFILE.name]);
  await saveProfile(DEMO_ORG_ID, DEMO_PROFILE);

  // A member, so visitors can explore and run analyses but not change settings or run discovery.
  const unguessable = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'Demo Visitor', 'member')`,
    [DEMO_USER_ID, DEMO_ORG_ID, DEMO_USER_EMAIL, unguessable],
  );

  const dimIds: number[] = [];
  for (const [i, d] of DEFAULT_DIMENSIONS.entries()) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO scoring_dimensions (org_id, name, description, weight, display_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [DEMO_ORG_ID, d.name, d.description, d.weight, i],
    );
    dimIds.push(row.id);
  }

  const outletIds = new Map<string, number>();
  for (const o of DEMO_OUTLETS) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO publications (org_id, name, url, tier, focus) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [DEMO_ORG_ID, o.name, o.url, o.tier, o.focus],
    );
    outletIds.set(o.key, row.id);
  }

  const { rows: [campaign] } = await pool.query(
    `INSERT INTO campaigns (org_id, name, brief, campaign_type, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [DEMO_ORG_ID, DEMO_CAMPAIGN.name, DEMO_CAMPAIGN.brief, DEMO_CAMPAIGN.type],
  );
  await pool.query(
    `INSERT INTO campaign_type_styles (org_id, campaign_type, instructions) VALUES ($1, $2, $3)`,
    [DEMO_ORG_ID, DEMO_CAMPAIGN.type, DEMO_CAMPAIGN.styleInstructions],
  );

  let coverageJournalistId: number | null = null;

  for (const j of DEMO_JOURNALISTS) {
    const outlet = DEMO_OUTLETS.find(o => o.key === j.outlet)!;
    const total = j.scores.reduce((a, b) => a + b, 0);
    const { rows: [jr] } = await pool.query(
      `INSERT INTO journalists (org_id, publication_id, name, email, bio, beats, total_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [DEMO_ORG_ID, outletIds.get(j.outlet), j.name, j.email, j.bio, j.beats, total],
    );

    for (const a of j.articles) {
      await pool.query(
        `INSERT INTO articles (org_id, journalist_id, title, url, published_at) VALUES ($1, $2, $3, $4, $5)`,
        [DEMO_ORG_ID, jr.id, a.title, articleUrl(j, a.slug), a.date],
      );
    }

    for (const [i, dimId] of dimIds.entries()) {
      const weight = DEFAULT_DIMENSIONS[i].weight;
      await pool.query(
        `INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score, rationale, evidence) VALUES ($1, $2, $3, $4, $5, $6)`,
        [DEMO_ORG_ID, jr.id, dimId, j.scores[i], rationaleFor(i, j, outlet.name, j.scores[i], weight), JSON.stringify(evidenceFor(i, j, j.scores[i], weight))],
      );
    }

    const draft = draftFor(j);
    const sent = !!j.outreach;
    await pool.query(
      `INSERT INTO campaign_journalists (org_id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${sent ? "NOW() - INTERVAL '20 days'" : 'NULL'})`,
      [DEMO_ORG_ID, campaign.id, jr.id, draft.subject, draft.body, sent ? 'sent' : 'ready'],
    );

    const logs: [string, string, number][] = j.outreach === 'Covered'
      ? [['pitch', 'Pitched', 20], ['response', 'Responded', 14], ['note', 'Covered', 5]]
      : j.outreach === 'Responded' ? [['pitch', 'Pitched', 14], ['response', 'Responded', 10]]
      : j.outreach === 'Pitched' ? [['pitch', 'Pitched', 7]] : [];
    for (const [type, status, daysAgo] of logs) {
      await pool.query(
        `INSERT INTO outreach_logs (org_id, journalist_id, campaign_id, logged_by, type, status, notes, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' days')::interval)`,
        [DEMO_ORG_ID, jr.id, campaign.id, DEMO_USER_ID, type, status, draft.subject, String(daysAgo)],
      );
    }
    if (j.outreach === 'Covered') coverageJournalistId = jr.id;
  }

  await pool.query(
    `INSERT INTO coverage (org_id, campaign_id, journalist_id, title, url, notes, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '5 days')`,
    [DEMO_ORG_ID, campaign.id, coverageJournalistId, DEMO_COVERAGE.title, DEMO_COVERAGE.url, DEMO_COVERAGE.notes],
  );
}
