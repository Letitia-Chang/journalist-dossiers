import { Router, type Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import pool, { inTransaction } from '../db';
import { generateCampaignDraft } from '../services/campaignDraftService';
import { getAuthedGmailClient, createGmailDraft } from '../services/gmailService';
import { isDemo, limitMessage, liveAiStatus, takeLiveAi } from '../demo/limits';
import { clientIp } from '../lib/clientIp';
import { HttpError } from '../lib/httpError';
import { assertOwned } from '../lib/owned';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const ALREADY_SENT = 'This pitch was already sent, so it is kept as a record.';

const CLAIM = 'creating';
/** A claim this old was interrupted (a restart), so the work can be taken again. */
const STALE = `updated_at < NOW() - INTERVAL '10 minutes'`;
/** No Gmail draft yet, or one whose creation was interrupted. */
const UNCLAIMED = `(gmail_draft_id IS NULL OR (gmail_draft_id = '${CLAIM}' AND ${STALE}))`;
const CREATING = `(gmail_draft_id = '${CLAIM}' AND NOT (${STALE}))`;
const WRITING = `(status = 'drafting' AND NOT (${STALE}))`;
const HAS_TEXT = `(draft_subject ~ '\\S' AND draft_body ~ '\\S')`;
const NO_TEXT = `(draft_subject !~ '\\S' AND draft_body !~ '\\S')`;
/** What a row is when nobody is writing it. */
const IDLE_STATUS = `CASE WHEN ${HAS_TEXT} THEN 'ready' ELSE 'not_started' END`;

const router = Router();
validateParams(router, { id: 'int', journalistId: 'int' });

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.brief, c.campaign_type, c.status, c.created_at, c.updated_at,
            COUNT(cj.id)::int as journalist_count,
            SUM(CASE WHEN cj.status = 'sent' THEN 1 ELSE 0 END)::int as sent_count,
            SUM(CASE WHEN cj.draft_subject != '' THEN 1 ELSE 0 END)::int as drafted_count
     FROM campaigns c
     LEFT JOIN campaign_journalists cj ON cj.campaign_id = c.id
     WHERE c.org_id = $1
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [req.orgId],
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT id, name, brief, campaign_type, status, created_at, updated_at FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { name, brief, campaignType } = parseBody(schemas.campaignCreate, req);
  const { rows: [row] } = await pool.query(
    `INSERT INTO campaigns (org_id, name, brief, campaign_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, brief, campaign_type, status, created_at, updated_at`,
    [req.orgId, name, brief ?? '', campaignType ?? ''],
  );
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { name, brief, campaignType, status } = parseBody(schemas.campaignUpdate, req);
  const { rows: [row] } = await pool.query(
    `UPDATE campaigns SET
       name = COALESCE($1, name),
       brief = COALESCE($2, brief),
       campaign_type = COALESCE($3, campaign_type),
       status = COALESCE($4, status),
       updated_at = NOW()
     WHERE id = $5 AND org_id = $6
     RETURNING id, name, brief, campaign_type, status, created_at, updated_at`,
    [name, brief, campaignType, status, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM campaigns WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// ── Campaign ↔ journalists ──────────────────────────────────────────────────

router.get('/:id/journalists', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cj.id, cj.campaign_id, cj.journalist_id, cj.draft_subject, cj.draft_body,
            CASE WHEN cj.status = 'drafting' AND cj.${STALE} THEN ${IDLE_STATUS} ELSE cj.status END AS status, cj.sent_at, NULLIF(cj.gmail_draft_id, '${CLAIM}') AS gmail_draft_id,
            j.name as journalist_name, j.email as journalist_email, j.beats as journalist_beats,
            p.name as publication_name
     FROM campaign_journalists cj
     JOIN journalists j ON j.id = cj.journalist_id
     LEFT JOIN publications p ON p.id = j.publication_id
     WHERE cj.campaign_id = $1 AND cj.org_id = $2
     ORDER BY cj.created_at ASC`,
    [req.params.id, req.orgId],
  );
  res.json(rows);
});

router.post('/:id/journalists', async (req, res) => {
  const { journalistIds } = parseBody(schemas.campaignAddJournalists, req);
  const { rows: [campaign] } = await pool.query(
    'SELECT id FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  await assertOwned(pool, req.orgId!, 'journalists', journalistIds);

  let added = 0;
  for (const journalistId of journalistIds) {
    const { rowCount } = await pool.query(
      `INSERT INTO campaign_journalists (org_id, campaign_id, journalist_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, journalist_id) DO NOTHING`,
      [req.orgId, req.params.id, journalistId],
    );
    added += rowCount ?? 0;
  }
  res.status(201).json({ added });
});

router.delete('/:id/journalists/:journalistId', async (req, res) => {
  const result = await pool.query(
    `DELETE FROM campaign_journalists WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3 AND status <> 'sent'`,
    [req.params.id, req.params.journalistId, req.orgId],
  );
  if (result.rowCount === 0) throw await whyNot(pool, req);
  res.status(204).end();
});

// ── AI draft generation ─────────────────────────────────────────────────────

router.post('/:id/generate-drafts', async (req, res) => {
  const { rows: [campaign] } = await pool.query(
    'SELECT id, brief, campaign_type FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Claim the rows before paying for anything, so a second click can't generate the same draft twice.
  const { rows: claimed } = await pool.query(
    `UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW()
     WHERE campaign_id = $1 AND org_id = $2 AND ${NO_TEXT}
       AND (status IN ('not_started', 'failed') OR (status = 'drafting' AND ${STALE}))
     RETURNING id, journalist_id, updated_at::text AS token`,
    [req.params.id, req.orgId],
  );
  claimed.sort((a, b) => a.id - b.id);
  const release = (ids: number[]) => pool.query(
    `UPDATE campaign_journalists SET status = 'not_started', updated_at = NOW() WHERE id = ANY($1::int[]) AND status = 'drafting'`, [ids]);

  // Demo safeguard: each draft is one live Claude call; only run as many as this visitor has left.
  let granted = 0;
  try {
    if (claimed.length > 0) granted = await takeLiveAi(clientIp(req), claimed.length);
  } catch (err) {
    await release(claimed.map(c => c.id));
    throw err;
  }
  const runnable = claimed.slice(0, granted);
  const skipped = claimed.length - runnable.length;
  if (skipped > 0) await release(claimed.slice(granted).map(c => c.id));
  if (claimed.length > 0 && granted === 0) {
    return res.status(429).json({ error: limitMessage(await liveAiStatus(clientIp(req))) });
  }

  res.json({
    generating: runnable.length,
    skipped,
    message: runnable.length === 0
      ? 'There is nothing to generate: every journalist here has a draft, or one is being written.'
      : `Generating drafts for ${runnable.length} journalist${runnable.length !== 1 ? 's' : ''}…`
        + (skipped > 0 ? ` ${skipped} left for later (demo limit).` : ''),
  });

  // The response is already sent, so nothing below may reject: one bad draft must not stop the rest.
  // Every row of the batch is claimed again before each call, which keeps a long batch from looking
  // interrupted and skips rows that were removed, written by hand or sent meanwhile before paying for them.
  let token: string | undefined = claimed[0]?.token;
  for (const [i, target] of runnable.entries()) {
    try {
      const { rows: held } = await pool.query(
        `UPDATE campaign_journalists SET updated_at = NOW()
         WHERE id = ANY($1::int[]) AND status = 'drafting' AND updated_at = $2::timestamptz
         RETURNING id, updated_at::text AS token`,
        [runnable.slice(i).map(r => r.id), token],
      );
      token = held[0]?.token ?? token;
      if (!held.some(h => h.id === target.id)) continue;
      const draft = await generateCampaignDraft({
        orgId: req.orgId!,
        journalistId: target.journalist_id,
        campaignBrief: campaign.brief,
        campaignType: campaign.campaign_type,
      });
      await pool.query(
        `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = $3, updated_at = NOW()
         WHERE id = $4 AND status = 'drafting' AND updated_at = $5::timestamptz`,
        [draft?.subject ?? '', draft?.body ?? '', draft ? 'ready' : 'failed', target.id, token],
      );
    } catch (err) {
      console.error(`[campaigns] draft for campaign_journalist ${target.id} failed`, err);
      await pool.query(`UPDATE campaign_journalists SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'drafting' AND updated_at = $2::timestamptz`, [target.id, token]).catch(() => {});
    }
  }
});

router.post('/:id/journalists/:journalistId/regenerate', async (req, res) => {
  const { instructions } = parseBody(schemas.regenerate, req);

  const { rows: [campaign] } = await pool.query(
    'SELECT id, brief, campaign_type FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Claim the row before paying, as above. The old text stays until there is a new one.
  const key = [req.params.id, req.params.journalistId, req.orgId];
  const { rows: [claim] } = await pool.query(
    `UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW()
     FROM (SELECT id AS old_id, status AS old_status FROM campaign_journalists
           WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3 FOR UPDATE) old
     WHERE id = old_id AND status <> 'sent' AND NOT ${WRITING} AND NOT COALESCE(${CREATING}, false)
     RETURNING id, old_status, updated_at::text AS token`,
    key,
  );
  if (!claim) throw await whyNot(pool, req);
  const release = (status: string) => pool.query(
    `UPDATE campaign_journalists SET status = CASE WHEN ${HAS_TEXT} THEN 'ready' ELSE $2 END, updated_at = NOW()
     WHERE id = $1 AND status = 'drafting' AND updated_at = $3::timestamptz`,
    [claim.id, status, claim.token],
  );
  const before = claim.old_status === 'failed' ? 'failed' : 'not_started';

  let draft: Awaited<ReturnType<typeof generateCampaignDraft>>;
  try {
    if ((await takeLiveAi(clientIp(req), 1)) === 0) {
      await release(before);
      return res.status(429).json({ error: limitMessage(await liveAiStatus(clientIp(req))) });
    }
    draft = await generateCampaignDraft({
      orgId: req.orgId!,
      journalistId: Number(req.params.journalistId),
      campaignBrief: campaign.brief,
      campaignType: campaign.campaign_type,
      extraInstructions: instructions ?? undefined,
    });
  } catch (err) {
    await release(before);
    throw err;
  }
  if (!draft) {
    await release('failed');
    return res.status(502).json({ error: 'AI draft generation failed. Check ANTHROPIC_API_KEY and server logs.' });
  }

  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = 'ready', gmail_draft_id = NULL, updated_at = NOW()
     WHERE id = $3 AND status = 'drafting' AND updated_at = $4::timestamptz
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draft.subject, draft.body, claim.id, claim.token],
  );
  if (!row) return res.status(409).json({ error: 'This pitch was changed while the AI was writing, so that version was kept.' });
  res.json(row);
});

router.put('/:id/journalists/:journalistId/draft', async (req, res) => {
  const { draftSubject, draftBody } = parseBody(schemas.draftUpdate, req);
  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET
       draft_subject = COALESCE($1, draft_subject),
       draft_body = COALESCE($2, draft_body),
       -- A pitch someone wrote themselves is ready, and any AI draft in progress gives way to it.
       -- An edited one no longer matches its copy in Gmail.
       status = CASE WHEN COALESCE($1, draft_subject) ~ '\\S' AND COALESCE($2, draft_body) ~ '\\S' THEN 'ready' ELSE 'not_started' END,
       gmail_draft_id = CASE WHEN COALESCE($1, draft_subject) <> draft_subject OR COALESCE($2, draft_body) <> draft_body THEN NULL ELSE gmail_draft_id END,
       updated_at = NOW()
     WHERE campaign_id = $3 AND journalist_id = $4 AND org_id = $5 AND status <> 'sent' AND NOT COALESCE(${CREATING}, false)
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draftSubject, draftBody, req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) throw await whyNot(pool, req);
  res.json(row);
});

router.post('/:id/journalists/:journalistId/send', async (req, res) => {
  const row = await inTransaction(async db => {
    // The status check is in the UPDATE, so a double click logs one pitch, not two.
    const { rows: [sent] } = await db.query(
      `UPDATE campaign_journalists SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3 AND status <> 'sent'
       RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
      [req.params.id, req.params.journalistId, req.orgId],
    );
    if (!sent) throw await whyNot(db, req);
    await db.query(
      `INSERT INTO outreach_logs (org_id, journalist_id, campaign_id, logged_by, type, status, notes)
       VALUES ($1, $2, $3, $4, 'pitch', 'Pitched', $5)`,
      [req.orgId, req.params.journalistId, req.params.id, req.userId, sent.draft_subject],
    );
    return sent;
  });
  res.json(row);
});

/** Why a change to a campaign's journalist matched no row. */
async function whyNot(db: Pool | PoolClient, req: Request): Promise<HttpError> {
  const { rows: [row] } = await db.query(
    `SELECT status, ${WRITING} AS writing FROM campaign_journalists WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3`,
    [req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) return new HttpError(404, 'Not found');
  if (row.status === 'sent') return new HttpError(409, ALREADY_SENT);
  return new HttpError(409, row.writing
    ? 'A draft is already being written for this journalist.'
    : 'A Gmail draft is being made from this pitch. Try again in a moment.');
}

// ── Gmail draft creation ─────────────────────────────────────────────────────

router.post('/:id/create-gmail-drafts', async (req, res) => {
  const { rows: [campaign] } = await pool.query(
    'SELECT id FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Demo: Gmail is disabled. Return what would have been created so the UI can show a preview.
  if (isDemo()) {
    const { rows: previews } = await pool.query(
      `SELECT j.name AS journalist_name, j.email AS "to", cj.draft_subject AS subject, cj.draft_body AS body
       FROM campaign_journalists cj JOIN journalists j ON j.id = cj.journalist_id
       WHERE cj.campaign_id = $1 AND cj.org_id = $2 AND ${HAS_TEXT} AND j.email != '' AND cj.status <> 'sent'
       ORDER BY cj.created_at ASC`,
      [req.params.id, req.orgId],
    );
    return res.json({ demo: true, previews });
  }

  const gmail = await getAuthedGmailClient(req.orgId!);
  if (!gmail) {
    return res.status(400).json({ error: 'Gmail is not connected. Connect it from House Style settings.' });
  }

  const { rows: targets } = await pool.query(
    `SELECT cj.id, j.email as journalist_email
     FROM campaign_journalists cj
     JOIN journalists j ON j.id = cj.journalist_id
     WHERE cj.campaign_id = $1 AND cj.org_id = $2
       AND ${HAS_TEXT} AND cj.status <> 'sent' AND NOT (cj.status = 'drafting' AND NOT (cj.${STALE}))
       AND (cj.gmail_draft_id IS NULL OR (cj.gmail_draft_id = '${CLAIM}' AND cj.${STALE}))`,
    [req.params.id, req.orgId],
  );

  let created = 0;
  let skippedNoEmail = 0;
  let failed = 0;
  let expired = false;
  for (const t of targets) {
    if (!t.journalist_email) { skippedNoEmail++; continue; }
    // Claim the row first, so a double click can't create the same draft twice and its text can't
    // change before Gmail has it. Read the text now: it may have been edited since the list was made.
    const { rows: [pitch] } = await pool.query(
      `UPDATE campaign_journalists SET gmail_draft_id = '${CLAIM}', updated_at = NOW()
       WHERE id = $1 AND status <> 'sent' AND NOT ${WRITING} AND ${HAS_TEXT} AND ${UNCLAIMED}
       RETURNING draft_subject, draft_body`, [t.id]);
    if (!pitch) continue;
    try {
      const draftId = await createGmailDraft(gmail, t.journalist_email, pitch.draft_subject, pitch.draft_body);
      await pool.query(`UPDATE campaign_journalists SET gmail_draft_id = $1, updated_at = NOW() WHERE id = $2 AND gmail_draft_id = '${CLAIM}'`, [draftId, t.id]);
      created++;
    } catch (err: any) {
      console.error(`[Gmail] Draft creation failed for campaign_journalist ${t.id}:`, err.message);
      failed++;
      expired ||= /invalid_grant|invalid_token|unauthorized/i.test(`${err.message} ${err.code ?? ''}`) || Number(err.code ?? err.status) === 401;
      await pool.query(`UPDATE campaign_journalists SET gmail_draft_id = NULL WHERE id = $1 AND gmail_draft_id = '${CLAIM}'`, [t.id]);
      if (expired) break; // every other one would fail the same way
    }
  }

  if (expired && created === 0) return res.status(400).json({ error: 'The Gmail connection has expired. Reconnect it from House Style settings.' });
  res.json({ created, skippedNoEmail, failed, expired, total: targets.length });
});

export default router;
