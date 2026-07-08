import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';
import { generateDraft } from '../services/campaignDraftService';
import type { CampaignType } from '../services/campaignDraftService';
import { createGmailDraft } from '../services/gmailService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router = Router();

// GET all campaigns
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        COUNT(cj.id)::int as "journalistCount",
        SUM(CASE WHEN cj."draftStatus" = 'approved' THEN 1 ELSE 0 END)::int as "approvedCount",
        SUM(CASE WHEN cj."draftStatus" = 'sent' THEN 1 ELSE 0 END)::int as "sentCount"
      FROM campaigns c
      LEFT JOIN campaign_journalists cj ON cj."campaignId" = c.id
      GROUP BY c.id
      ORDER BY c."createdAt" DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type = 'cold_intro', brief = '', status = 'draft' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO campaigns (name, type, brief, status) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, type, brief, status]
    );
    const created = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const {
      name = existing.name, type = existing.type, brief = existing.brief, status = existing.status,
      pressKitUrl = existing.pressKitUrl ?? '', photoFolderUrl = existing.photoFolderUrl ?? '',
      demoUrl = existing.demoUrl ?? '', boilerplate = existing.boilerplate ?? '',
    } = req.body;
    await pool.query(
      `UPDATE campaigns SET name=$1, type=$2, brief=$3, status=$4,
       "pressKitUrl"=$5, "photoFolderUrl"=$6, "demoUrl"=$7, boilerplate=$8, "updatedAt"=NOW()
       WHERE id=$9`,
      [name, type, brief, status, pressKitUrl, photoFolderUrl, demoUrl, boilerplate, req.params.id]
    );
    res.json((await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET journalists in a campaign
router.get('/:id/journalists', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT cj.*, j.name, j.publication, j.beat, j."roleTitle", j.email,
             j."outreachStatus", j."totalScore", j."priorityTier", j."bestPitchAngle",
             j."isFavorite", j."staleFlag"
      FROM campaign_journalists cj
      JOIN journalists j ON j.id = cj."journalistId"
      WHERE cj."campaignId" = $1
      ORDER BY cj."createdAt" ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST add journalists to campaign (bulk)
router.post('/:id/journalists', async (req: Request, res: Response) => {
  try {
    const { journalistIds }: { journalistIds: number[] } = req.body;
    if (!Array.isArray(journalistIds) || journalistIds.length === 0) {
      return res.status(400).json({ error: 'journalistIds array is required' });
    }
    const campaign = (await pool.query('SELECT id FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const jid of journalistIds) {
        await client.query(
          'INSERT INTO campaign_journalists ("campaignId", "journalistId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, jid]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ added: journalistIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE remove a journalist from a campaign
router.delete('/:id/journalists/:journalistId', async (req: Request, res: Response) => {
  try {
    await pool.query(
      'DELETE FROM campaign_journalists WHERE "campaignId" = $1 AND "journalistId" = $2',
      [req.params.id, req.params.journalistId]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST generate Claude drafts for all pending journalists
router.post('/:id/generate-drafts', async (req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }
  try {
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const pending = (await pool.query(
      'SELECT "journalistId" FROM campaign_journalists WHERE "campaignId" = $1 AND "draftStatus" = \'pending\'',
      [req.params.id]
    )).rows;

    if (pending.length === 0) return res.json({ count: 0, message: 'No pending drafts to generate.' });

    res.json({
      count: pending.length,
      message: `Generating ${pending.length} draft${pending.length !== 1 ? 's' : ''} with Claude. Refresh to see them appear.`,
    });

    const signerName = (req.headers['x-user-name'] as string) || '';
    const signerTitle = (req.headers['x-user-title'] as string) || '';
    const assets = {
      pressKitUrl: campaign.pressKitUrl || '',
      photoFolderUrl: campaign.photoFolderUrl || '',
      demoUrl: campaign.demoUrl || '',
      boilerplate: campaign.boilerplate || '',
    };

    (async () => {
      for (const { journalistId } of pending) {
        const draft = await generateDraft(journalistId, campaign.type as CampaignType, campaign.brief, signerName, signerTitle, '', assets);
        if (draft) {
          await pool.query(`
            UPDATE campaign_journalists SET "draftSubject"=$1, "draftBody"=$2, "draftStatus"='ready'
            WHERE "campaignId"=$3 AND "journalistId"=$4
          `, [draft.subject, draft.body, campaign.id, journalistId]);
        } else {
          await pool.query(
            "UPDATE campaign_journalists SET \"draftStatus\"='failed' WHERE \"campaignId\"=$1 AND \"journalistId\"=$2",
            [campaign.id, journalistId]
          );
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`[CampaignDraft] Done — ${pending.length} drafts processed.`);
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update a single draft
router.put('/:id/journalists/:journalistId/draft', async (req: Request, res: Response) => {
  try {
    const { draftSubject, draftBody, draftStatus } = req.body;

    // If content is being saved without an explicit status, promote out of
    // 'pending' so it isn't re-targeted (and overwritten) by generate-drafts,
    // and so it shows up in the Review Drafts tab instead of looking untouched.
    let nextStatus = draftStatus ?? null;
    if (!nextStatus && (draftSubject || draftBody)) {
      const current = (await pool.query(
        'SELECT "draftStatus" FROM campaign_journalists WHERE "campaignId" = $1 AND "journalistId" = $2',
        [req.params.id, req.params.journalistId]
      )).rows[0];
      if (current?.draftStatus === 'pending') nextStatus = 'ready';
    }

    await pool.query(`
      UPDATE campaign_journalists
      SET "draftSubject" = COALESCE($1, "draftSubject"),
          "draftBody"    = COALESCE($2, "draftBody"),
          "draftStatus"  = COALESCE($3, "draftStatus")
      WHERE "campaignId" = $4 AND "journalistId" = $5
    `, [draftSubject ?? null, draftBody ?? null, nextStatus, req.params.id, req.params.journalistId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST regenerate a single draft with optional instructions
router.post('/:id/journalists/:journalistId/regenerate', async (req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }
  try {
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { instructions = '' } = req.body;
    const signerName = (req.headers['x-user-name'] as string) || '';
    const signerTitle = (req.headers['x-user-title'] as string) || '';

    await pool.query(
      "UPDATE campaign_journalists SET \"draftStatus\"='pending' WHERE \"campaignId\"=$1 AND \"journalistId\"=$2",
      [req.params.id, req.params.journalistId]
    );

    res.json({ message: 'Regenerating draft…' });

    (async () => {
      const draft = await generateDraft(
        Number(req.params.journalistId),
        campaign.type as CampaignType,
        campaign.brief,
        signerName,
        signerTitle,
        instructions,
        { pressKitUrl: campaign.pressKitUrl, photoFolderUrl: campaign.photoFolderUrl, demoUrl: campaign.demoUrl, boilerplate: campaign.boilerplate },
      );
      if (draft) {
        await pool.query(
          `UPDATE campaign_journalists SET "draftSubject"=$1, "draftBody"=$2, "draftStatus"='ready'
           WHERE "campaignId"=$3 AND "journalistId"=$4`,
          [draft.subject, draft.body, req.params.id, req.params.journalistId]
        );
      } else {
        await pool.query(
          "UPDATE campaign_journalists SET \"draftStatus\"='failed' WHERE \"campaignId\"=$1 AND \"journalistId\"=$2",
          [req.params.id, req.params.journalistId]
        );
      }
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST mark a draft as sent
router.post('/:id/journalists/:journalistId/send', async (req: Request, res: Response) => {
  try {
    const cj = (await pool.query(`
      SELECT cj.*, j.publication FROM campaign_journalists cj
      JOIN journalists j ON j.id = cj."journalistId"
      WHERE cj."campaignId" = $1 AND cj."journalistId" = $2
    `, [req.params.id, req.params.journalistId])).rows[0];

    if (!cj) return res.status(404).json({ error: 'Not found' });

    const today = new Date().toISOString().split('T')[0];
    const messageType = getCampaignMessageType(req.body.campaignType || 'cold_intro');

    const logResult = await pool.query(`
      INSERT INTO outreach_logs ("journalistId", date, channel, "messageType", "subjectLine", "messageBody", status, "nextStep")
      VALUES ($1,$2,'Email',$3,$4,$5,'Sent','Follow up in 7 days if no response') RETURNING id
    `, [req.params.journalistId, today, messageType, cj.draftSubject, cj.draftBody]);

    await pool.query(
      'UPDATE campaign_journalists SET "draftStatus"=\'sent\', "sentAt"=$1 WHERE "campaignId"=$2 AND "journalistId"=$3',
      [today, req.params.id, req.params.journalistId]
    );

    syncJournalistAfterSend(Number(req.params.journalistId), today).catch(console.error);

    res.json({ success: true, outreachLogId: logResult.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST suggest journalists for a campaign using Claude
router.post('/:id/suggest-journalists', async (req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }
  try {
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Already-added journalist IDs
    const addedIds = new Set(
      (await pool.query('SELECT "journalistId" FROM campaign_journalists WHERE "campaignId" = $1', [req.params.id]))
        .rows.map((r: any) => r.journalistId)
    );

    // All journalists with full data
    const journalists = (await pool.query(`
      SELECT j.id, j.name, j.publication, j.beat, j."roleTitle", j.email,
             j."outreachStatus", j."totalScore", j."aiRelevanceScore", j."startupRelevanceScore",
             j."northStarFitScore", j."publicationAuthorityScore", j."audienceReachScore",
             j."contactabilityScore", j."bestPitchAngle", j."lastArticleDate",
             j."staleFlag", j."isFavorite", j."followerCount",
             j.notes, j."adminNotes"
      FROM journalists j
      WHERE j."outreachStatus" != 'Not a Fit'
      ORDER BY j."totalScore" DESC
    `)).rows;

    // Coverage articles — flag journalists who have written about North Star
    const coverage = (await pool.query(`
      SELECT "journalistId", "journalistName", title, publication, "publishDate", sentiment
      FROM coverage
      WHERE "journalistId" IS NOT NULL OR "journalistName" != ''
    `)).rows;

    const coveredByJournalistId = new Set(coverage.filter((c: any) => c.journalistId).map((c: any) => c.journalistId));
    const coveredByName = new Set(coverage.filter((c: any) => c.journalistName).map((c: any) => (c.journalistName as string).toLowerCase()));

    // Build journalist context for Claude
    const journalistContext = journalists.map((j: any) => {
      const hasWrittenAboutUs = coveredByJournalistId.has(j.id) || coveredByName.has((j.name as string).toLowerCase());
      const daysSincePublished = j.lastArticleDate
        ? Math.floor((Date.now() - new Date(j.lastArticleDate).getTime()) / 86_400_000)
        : null;
      const alreadyAdded = addedIds.has(j.id);

      return {
        id: j.id,
        name: j.name,
        publication: j.publication,
        beat: j.beat,
        roleTitle: j.roleTitle,
        hasEmail: !!j.email,
        outreachStatus: j.outreachStatus,
        totalScore: j.totalScore,
        scoreBreakdown: {
          aiRelevance: j.aiRelevanceScore,
          startupRelevance: j.startupRelevanceScore,
          northStarFit: j.northStarFitScore,
          publicationAuthority: j.publicationAuthorityScore,
          audienceReach: j.audienceReachScore,
          contactability: j.contactabilityScore,
        },
        bestPitchAngle: j.bestPitchAngle,
        followerCount: j.followerCount,
        daysSinceLastPublished: daysSincePublished,
        isStale: j.staleFlag,
        isFavorite: j.isFavorite,
        hasWrittenAboutNorthStar: hasWrittenAboutUs,
        notes: [j.notes, j.adminNotes].filter(Boolean).join(' | ') || null,
        alreadyInCampaign: alreadyAdded,
      };
    });

    const prompt = `You are helping the communications team at North Star AI Labs select journalists for a targeted outreach campaign.

CAMPAIGN BRIEF:
Name: ${campaign.name}
Type: ${campaign.type}
Brief: ${campaign.brief}

JOURNALIST ROSTER (${journalistContext.length} total):
${JSON.stringify(journalistContext, null, 2)}

Your task: Rank ALL journalists by fit for this specific campaign. Return a JSON array sorted best-to-worst.

For each journalist return:
{
  "id": <number>,
  "recommended": <true|false>,  // true = actively recommend adding; false = available but lower priority
  "priority": <"high"|"medium"|"low">,
  "reasons": [<1-3 short reason strings, max 8 words each>],
  "warning": <string|null>  // only if there's a notable concern (stale, no email, declined before, already added, etc.)
}

Scoring logic to apply (weighted, not just totalScore):
1. WARMTH (highest weight): Has written about North Star = top signal. outreachStatus of "Responded", "In Conversation", "Covered" = warm relationship.
2. BEAT FIT: Does their specific beat match the campaign angle? Generic "Technology" is weaker than "AI Startups & Venture Funding".
3. CONTACTABILITY: hasEmail = true is required for a realistic outreach. If no email, lower priority.
4. RECENCY: daysSinceLastPublished > 90 = concern. > 180 = flag in warning.
5. SCORE: Use as a tiebreaker, not the primary signal.
6. alreadyInCampaign: Always mark recommended: false, note in warning.

Recommend 5-7 journalists (recommended: true). The rest should be recommended: false but still ranked.

Return ONLY valid JSON array, no markdown, no explanation.`;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = msg.content.find((b: any) => b.type === 'text') as { type: 'text'; text: string } | undefined;
    if (!textBlock) throw new Error('No text response from Claude');

    // Strip markdown fences if present
    const raw = textBlock.text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const suggestions = JSON.parse(raw);

    // Merge back full journalist data so frontend doesn't need a second fetch
    const journalistMap = new Map(journalists.map((j: any) => [j.id, j]));
    const coverageMap = new Map<number, any[]>();
    for (const c of coverage) {
      if (c.journalistId) {
        if (!coverageMap.has(c.journalistId)) coverageMap.set(c.journalistId, []);
        coverageMap.get(c.journalistId)!.push(c);
      }
    }

    const enriched = suggestions.map((s: any) => {
      const j = journalistMap.get(s.id);
      return {
        ...s,
        name: j?.name,
        publication: j?.publication,
        beat: j?.beat,
        outreachStatus: j?.outreachStatus,
        totalScore: j?.totalScore,
        hasEmail: !!j?.email,
        hasWrittenAboutNorthStar: coveredByJournalistId.has(s.id) || coveredByName.has((j?.name || '').toLowerCase()),
        northStarArticles: coverageMap.get(s.id) || [],
        followerCount: j?.followerCount,
        daysSinceLastPublished: j?.lastArticleDate
          ? Math.floor((Date.now() - new Date(j.lastArticleDate).getTime()) / 86_400_000)
          : null,
        alreadyInCampaign: addedIds.has(s.id),
      };
    });

    res.json({ suggestions: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getCampaignMessageType(type: string): string {
  switch (type) {
    case 'cold_intro': return 'Initial Pitch';
    case 'event': return 'Story Tip';
    case 'hackathon': return 'Story Tip';
    case 'founder_promo': return 'Story Tip';
    default: return 'Initial Pitch';
  }
}

async function syncJournalistAfterSend(journalistId: number, date: string): Promise<void> {
  const logs = (await pool.query(
    'SELECT * FROM outreach_logs WHERE "journalistId" = $1 ORDER BY date DESC, "createdAt" DESC',
    [journalistId]
  )).rows;

  const priority: Record<string, number> = {
    'Not a Fit': 8, 'Declined': 8, 'Covered': 7, 'Meeting Scheduled': 6,
    'Responded': 5, 'Sent': 3, 'No Response': 3, 'Draft': 0,
  };
  const toStatus: Record<string, string> = {
    'Not a Fit': 'Not a Fit', 'Declined': 'Not a Fit', 'Covered': 'Covered',
    'Meeting Scheduled': 'In Conversation', 'Responded': 'Responded',
    'Sent': 'Pitched', 'No Response': 'Pitched',
  };

  let best = ''; let bestP = -1;
  for (const log of logs) {
    const p = priority[log.status] ?? 0;
    if (p > bestP) { bestP = p; best = log.status; }
  }
  if (bestP <= 0) return;

  const newStatus = toStatus[best];
  if (!newStatus) return;

  const followUp = new Date(date);
  followUp.setDate(followUp.getDate() + 7);
  const followUpDate = followUp.toISOString().split('T')[0];

  await pool.query(`
    UPDATE journalists SET
      "outreachStatus" = $1,
      "lastContactedDate" = $2,
      "nextFollowUpDate" = CASE WHEN "nextFollowUpDate" IS NULL OR "nextFollowUpDate" = '' THEN $3 ELSE "nextFollowUpDate" END,
      "updatedAt" = NOW()
    WHERE id = $4
  `, [newStatus, date, followUpDate, journalistId]);
}

// POST /:id/create-gmail-drafts — create Gmail drafts for all approved journalists
router.post('/:id/create-gmail-drafts', async (req: Request, res: Response) => {
  try {
    const cjs = (await pool.query(`
      SELECT cj.*, j.name, j.email FROM campaign_journalists cj
      JOIN journalists j ON j.id = cj."journalistId"
      WHERE cj."campaignId" = $1 AND cj."draftStatus" = 'approved'
    `, [req.params.id])).rows;

    if (cjs.length === 0) return res.status(400).json({ error: 'No approved drafts found' });

    const results: { name: string; email: string; success: boolean; error?: string }[] = [];
    for (const cj of cjs) {
      if (!cj.email) {
        results.push({ name: cj.name, email: '', success: false, error: 'No email on file' });
        continue;
      }
      try {
        await createGmailDraft(cj.email, cj.draftSubject || '(no subject)', cj.draftBody || '');
        results.push({ name: cj.name, email: cj.email, success: true });
      } catch (err: any) {
        results.push({ name: cj.name, email: cj.email, success: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/coverage — list coverage linked to this campaign
router.get('/:id/coverage', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM coverage WHERE "campaignId" = $1 ORDER BY "publishDate" DESC, "createdAt" DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/coverage/link — link an existing coverage record to this campaign
router.post('/:id/coverage/link', async (req: Request, res: Response) => {
  try {
    const { coverageId } = req.body;
    if (!coverageId) return res.status(400).json({ error: 'coverageId required' });
    await pool.query('UPDATE coverage SET "campaignId" = $1 WHERE id = $2', [req.params.id, coverageId]);
    const row = (await pool.query('SELECT * FROM coverage WHERE id = $1', [coverageId])).rows[0];
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id/coverage/:coverageId/unlink — unlink coverage from this campaign
router.delete('/:id/coverage/:coverageId/unlink', async (req: Request, res: Response) => {
  try {
    await pool.query('UPDATE coverage SET "campaignId" = NULL WHERE id = $1 AND "campaignId" = $2', [req.params.coverageId, req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
