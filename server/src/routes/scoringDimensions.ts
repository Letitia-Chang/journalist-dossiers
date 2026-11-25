import { Router } from 'express';
import pool, { inTransaction } from '../db';
import { HttpError } from '../lib/httpError';
import { lockJournalists, recomputeTotals } from '../lib/scores';
import { requireRole } from '../middleware/auth';
import * as schemas from '../lib/schemas';
import { parseBody, validateParams } from '../lib/validate';

const router = Router();
validateParams(router, { id: 'int' });

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
  const { name, description, weight, displayOrder } = parseBody(schemas.dimensionCreate, req);
  const { rows: [row] } = await pool.query(
    `INSERT INTO scoring_dimensions (org_id, name, description, weight, display_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, weight, display_order`,
    [req.orgId, name, description ?? '', weight ?? 0, displayOrder ?? 0],
  );
  res.status(201).json(row);
});

router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const { name, description, weight, displayOrder } = parseBody(schemas.dimensionUpdate, req);
  const row = await inTransaction(async db => {
    await lockJournalists(db, req.orgId!);
    const { rows: [updated] } = await db.query(
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
    if (!updated) throw new HttpError(404, 'Not found');
    // Lowering a maximum must not leave scores above it.
    const { rowCount } = await db.query(
      'UPDATE journalist_scores SET score = $1 WHERE dimension_id = $2 AND org_id = $3 AND score > $1',
      [updated.weight, updated.id, req.orgId],
    );
    if (rowCount) await recomputeTotals(db, req.orgId!);
    return updated;
  });
  res.json(row);
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  await inTransaction(async db => {
    await lockJournalists(db, req.orgId!);
    const result = await db.query('DELETE FROM scoring_dimensions WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
    if (result.rowCount === 0) throw new HttpError(404, 'Not found');
    await recomputeTotals(db, req.orgId!); // the dimension's scores were deleted with it
  });
  res.status(204).end();
});

export default router;
