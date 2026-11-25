import { Router } from 'express';
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
/** No Gmail draft yet, or one whose creation was interrupted. */
const UNCLAIMED = `(cj.gmail_draft_id IS NULL OR (cj.gmail_draft_id = '${CLAIM}' AND cj.updated_at < NOW() - INTERVAL '10 minutes'))`;

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
    `SELECT cj.id, cj.campaign_id, cj.journalist_id, cj.draft_subject, cj.draft_body, cj.status, cj.sent_at, NULLIF(cj.gmail_draft_id, '${CLAIM}') AS gmail_draft_id,
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
  if (result.rowCount === 0) throw await notFoundOrSent(pool, req.params.id, req.params.journalistId, req.orgId!);
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
  // A claim older than ten minutes was interrupted (a restart) and can be taken again.
  const { rows: claimed } = await pool.query(
    `UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW()
     WHERE campaign_id = $1 AND org_id = $2 AND draft_subject = '' AND draft_body = ''
       AND (status IN ('not_started', 'failed') OR (status = 'drafting' AND updated_at < NOW() - INTERVAL '10 minutes'))
     RETURNING id, journalist_id`,
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
  // Only a row still being drafted is written, so a pitch someone wrote or sent meanwhile is kept.
  for (const target of runnable) {
    try {
      const draft = await generateCampaignDraft({
        orgId: req.orgId!,
        journalistId: target.journalist_id,
        campaignBrief: campaign.brief,
        campaignType: campaign.campaign_type,
      });
      await pool.query(
        `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = $3, updated_at = NOW()
         WHERE id = $4 AND status = 'drafting'`,
        [draft?.subject ?? '', draft?.body ?? '', draft ? 'ready' : 'failed', target.id],
      );
    } catch (err) {
      console.error(`[campaigns] draft for campaign_journalist ${target.id} failed`, err);
      await pool.query(`UPDATE campaign_journalists SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'drafting'`, [target.id]).catch(() => {});
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

  // Check membership before spending a live call on a draft that could not be saved.
  const { rows: [member] } = await pool.query(
    `SELECT id, status, updated_at > NOW() - INTERVAL '10 minutes' AS fresh FROM campaign_journalists WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3`,
    [req.params.id, req.params.journalistId, req.orgId],
  );
  if (!member) return res.status(404).json({ error: 'Not found' });
  if (member.status === 'sent') return res.status(409).json({ error: ALREADY_SENT });
  if (member.status === 'drafting' && member.fresh) return res.status(409).json({ error: 'A draft is already being written for this journalist.' });

  if ((await takeLiveAi(clientIp(req), 1)) === 0) {
    return res.status(429).json({ error: limitMessage(await liveAiStatus(clientIp(req))) });
  }
  const draft = await generateCampaignDraft({
    orgId: req.orgId!,
    journalistId: Number(req.params.journalistId),
    campaignBrief: campaign.brief,
    campaignType: campaign.campaign_type,
    extraInstructions: instructions ?? undefined,
  });
  if (!draft) return res.status(502).json({ error: 'AI draft generation failed. Check ANTHROPIC_API_KEY and server logs.' });

  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = 'ready', gmail_draft_id = NULL, updated_at = NOW()
     WHERE campaign_id = $3 AND journalist_id = $4 AND org_id = $5 AND status <> 'sent'
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draft.subject, draft.body, req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) return res.status(409).json({ error: ALREADY_SENT });
  res.json(row);
});

router.put('/:id/journalists/:journalistId/draft', async (req, res) => {
  const { draftSubject, draftBody } = parseBody(schemas.draftUpdate, req);
  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET
       draft_subject = COALESCE($1, draft_subject),
       draft_body = COALESCE($2, draft_body),
       -- A pitch someone wrote themselves is ready; an edited one no longer matches its copy in Gmail.
       status = CASE WHEN COALESCE($1, draft_subject) <> '' AND COALESCE($2, draft_body) <> '' THEN 'ready' ELSE status END,
       gmail_draft_id = CASE WHEN COALESCE($1, draft_subject) <> draft_subject OR COALESCE($2, draft_body) <> draft_body THEN NULL ELSE gmail_draft_id END,
       updated_at = NOW()
     WHERE campaign_id = $3 AND journalist_id = $4 AND org_id = $5 AND status <> 'sent'
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draftSubject, draftBody, req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) throw await notFoundOrSent(pool, req.params.id, req.params.journalistId, req.orgId!);
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
    if (!sent) throw await notFoundOrSent(db, req.params.id, req.params.journalistId, req.orgId!);
    await db.query(
      `INSERT INTO outreach_logs (org_id, journalist_id, campaign_id, logged_by, type, status, notes)
       VALUES ($1, $2, $3, $4, 'pitch', 'Pitched', $5)`,
      [req.orgId, req.params.journalistId, req.params.id, req.userId, sent.draft_subject],
    );
    return sent;
  });
  res.json(row);
});

async function notFoundOrSent(db: Pool | PoolClient, campaignId: unknown, journalistId: unknown, orgId: string): Promise<HttpError> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM campaign_journalists WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3', [campaignId, journalistId, orgId],
  );
  return rowCount ? new HttpError(409, ALREADY_SENT) : new HttpError(404, 'Not found');
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
       WHERE cj.campaign_id = $1 AND cj.org_id = $2 AND cj.draft_subject != '' AND j.email != '' AND cj.status <> 'sent'
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
    `SELECT cj.id, cj.draft_subject, cj.draft_body, j.email as journalist_email
     FROM campaign_journalists cj
     JOIN journalists j ON j.id = cj.journalist_id
     WHERE cj.campaign_id = $1 AND cj.org_id = $2
       AND cj.draft_subject != '' AND cj.status <> 'sent' AND ${UNCLAIMED}`,
    [req.params.id, req.orgId],
  );

  let created = 0;
  let skippedNoEmail = 0;
  let failed = 0;
  let expired = false;
  for (const t of targets) {
    if (!t.journalist_email) { skippedNoEmail++; continue; }
    // Claim the row first, so a double click can't create the same draft twice.
    const { rowCount: claimed } = await pool.query(
      `UPDATE campaign_journalists cj SET gmail_draft_id = '${CLAIM}', updated_at = NOW() WHERE cj.id = $1 AND cj.status <> 'sent' AND ${UNCLAIMED}`, [t.id]);
    if (!claimed) continue;
    try {
      const draftId = await createGmailDraft(gmail, t.journalist_email, t.draft_subject, t.draft_body);
      await pool.query(`UPDATE campaign_journalists SET gmail_draft_id = $1, updated_at = NOW() WHERE id = $2`, [draftId, t.id]);
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
  res.json({ created, skippedNoEmail, failed, total: targets.length });
});

export default router;
