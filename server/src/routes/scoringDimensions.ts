import { Router } from 'express';
import pool from '../db';
import { requireRole } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, weight, display_order
     FROM scoring_dimensions WHERE org_id = $1
     ORDER BY display_order ASC, id ASC`,
    [req.orgId],
  );
  res.json(rows);
});

router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const { name, description, weight, displayOrder } = req.body as {
    name?: string; description?: string; weight?: number; displayOrder?: number;
  };
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO scoring_dimensions (org_id, name, description, weight, display_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, weight, display_order`,
    [req.orgId, name, description ?? '', weight ?? 0, displayOrder ?? 0],
  );
  res.status(201).json(row);
});

router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const { name, description, weight, displayOrder } = req.body as {
    name?: string; description?: string; weight?: number; displayOrder?: number;
  };
  const { rows: [row] } = await pool.query(
    `UPDATE scoring_dimensions SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       weight = COALESCE($3, weight),
       display_order = COALESCE($4, display_order),
       updated_at = NOW()
     WHERE id = $5 AND org_id = $6
     RETURNING id, name, description, weight, display_order`,
    [name, description, weight, displayOrder, req.params.id, req.orgId],
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const result = await pool.query(
    'DELETE FROM scoring_dimensions WHERE id = $1 AND org_id = $2',
    [req.params.id, req.orgId],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
