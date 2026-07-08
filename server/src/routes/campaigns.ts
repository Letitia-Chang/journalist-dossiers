import { Router } from 'express';
import pool from '../db';
import { generateCampaignDraft } from '../services/campaignDraftService';
import { getAuthedGmailClient, createGmailDraft } from '../services/gmailService';

const router = Router();

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
  const { name, brief, campaignType } = req.body as { name?: string; brief?: string; campaignType?: string };
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO campaigns (org_id, name, brief, campaign_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, brief, campaign_type, status, created_at, updated_at`,
    [req.orgId, name, brief ?? '', campaignType ?? ''],
  );
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { name, brief, campaignType, status } = req.body as {
    name?: string; brief?: string; campaignType?: string; status?: string;
  };
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
    `SELECT cj.id, cj.campaign_id, cj.journalist_id, cj.draft_subject, cj.draft_body, cj.status, cj.sent_at, cj.gmail_draft_id,
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
  const { journalistIds } = req.body as { journalistIds?: number[] };
  if (!journalistIds?.length) return res.status(400).json({ error: 'journalistIds is required' });

  const { rows: [campaign] } = await pool.query(
    'SELECT id FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  for (const journalistId of journalistIds) {
    await pool.query(
      `INSERT INTO campaign_journalists (org_id, campaign_id, journalist_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, journalist_id) DO NOTHING`,
      [req.orgId, req.params.id, journalistId],
    );
  }
  res.status(201).json({ added: journalistIds.length });
});

router.delete('/:id/journalists/:journalistId', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM campaign_journalists WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3',
    [req.params.id, req.params.journalistId, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// ── AI draft generation ─────────────────────────────────────────────────────

router.post('/:id/generate-drafts', async (req, res) => {
  const { rows: [campaign] } = await pool.query(
    'SELECT id, brief, campaign_type FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { rows: targets } = await pool.query(
    `SELECT id, journalist_id FROM campaign_journalists
     WHERE campaign_id = $1 AND org_id = $2 AND draft_subject = ''`,
    [req.params.id, req.orgId],
  );

  res.json({ message: `Generating drafts for ${targets.length} journalist${targets.length !== 1 ? 's' : ''}…` });

  for (const target of targets) {
    const draft = await generateCampaignDraft({
      orgId: req.orgId!,
      journalistId: target.journalist_id,
      campaignBrief: campaign.brief,
      campaignType: campaign.campaign_type,
    });
    if (draft) {
      await pool.query(
        `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = 'ready', updated_at = NOW()
         WHERE id = $3`,
        [draft.subject, draft.body, target.id],
      );
    } else {
      await pool.query(
        `UPDATE campaign_journalists SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [target.id],
      );
    }
  }
});

router.post('/:id/journalists/:journalistId/regenerate', async (req, res) => {
  const { instructions } = req.body as { instructions?: string };

  const { rows: [campaign] } = await pool.query(
    'SELECT id, brief, campaign_type FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const draft = await generateCampaignDraft({
    orgId: req.orgId!,
    journalistId: Number(req.params.journalistId),
    campaignBrief: campaign.brief,
    campaignType: campaign.campaign_type,
    extraInstructions: instructions,
  });
  if (!draft) return res.status(502).json({ error: 'AI draft generation failed. Check ANTHROPIC_API_KEY and server logs.' });

  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET draft_subject = $1, draft_body = $2, status = 'ready', updated_at = NOW()
     WHERE campaign_id = $3 AND journalist_id = $4 AND org_id = $5
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draft.subject, draft.body, req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.put('/:id/journalists/:journalistId/draft', async (req, res) => {
  const { draftSubject, draftBody } = req.body as { draftSubject?: string; draftBody?: string };
  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET
       draft_subject = COALESCE($1, draft_subject),
       draft_body = COALESCE($2, draft_body),
       updated_at = NOW()
     WHERE campaign_id = $3 AND journalist_id = $4 AND org_id = $5
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [draftSubject, draftBody, req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/:id/journalists/:journalistId/send', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE campaign_journalists SET status = 'sent', sent_at = NOW(), updated_at = NOW()
     WHERE campaign_id = $1 AND journalist_id = $2 AND org_id = $3
     RETURNING id, campaign_id, journalist_id, draft_subject, draft_body, status, sent_at`,
    [req.params.id, req.params.journalistId, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    `INSERT INTO outreach_logs (org_id, journalist_id, campaign_id, logged_by, type, status, notes)
     VALUES ($1, $2, $3, $4, 'pitch', 'Pitched', $5)`,
    [req.orgId, req.params.journalistId, req.params.id, req.userId, row.draft_subject],
  );

  res.json(row);
});

// ── Gmail draft creation ─────────────────────────────────────────────────────

router.post('/:id/create-gmail-drafts', async (req, res) => {
  const { rows: [campaign] } = await pool.query(
    'SELECT id FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const gmail = await getAuthedGmailClient(req.orgId!);
  if (!gmail) {
    return res.status(400).json({ error: 'Gmail is not connected. Connect it from House Style settings.' });
  }

  const { rows: targets } = await pool.query(
    `SELECT cj.id, cj.draft_subject, cj.draft_body, j.email as journalist_email
     FROM campaign_journalists cj
     JOIN journalists j ON j.id = cj.journalist_id
     WHERE cj.campaign_id = $1 AND cj.org_id = $2
       AND cj.draft_subject != '' AND cj.gmail_draft_id IS NULL`,
    [req.params.id, req.orgId],
  );

  let created = 0;
  let skippedNoEmail = 0;
  for (const t of targets) {
    if (!t.journalist_email) { skippedNoEmail++; continue; }
    try {
      const draftId = await createGmailDraft(gmail, t.journalist_email, t.draft_subject, t.draft_body);
      await pool.query(`UPDATE campaign_journalists SET gmail_draft_id = $1, updated_at = NOW() WHERE id = $2`, [draftId, t.id]);
      created++;
    } catch (err: any) {
      console.error(`[Gmail] Draft creation failed for campaign_journalist ${t.id}:`, err.message);
    }
  }

  res.json({ created, skippedNoEmail, total: targets.length });
});

export default router;
