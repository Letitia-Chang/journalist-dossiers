import { Router } from 'express';
import pool from '../db';
import { requireRole } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT campaign_type, instructions, updated_at FROM campaign_type_styles WHERE org_id = $1',
    [req.orgId],
  );
  res.json(rows);
});

router.put('/:campaignType', requireRole('owner', 'admin'), async (req, res) => {
  const { instructions } = req.body as { instructions?: string };
  const { rows: [row] } = await pool.query(
    `INSERT INTO campaign_type_styles (org_id, campaign_type, instructions)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, campaign_type)
     DO UPDATE SET instructions = $3, updated_at = NOW()
     RETURNING campaign_type, instructions, updated_at`,
    [req.orgId, req.params.campaignType, instructions ?? ''],
  );
  res.json(row);
});

export default router;
