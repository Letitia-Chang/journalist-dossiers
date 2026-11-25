import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import pool from '../db';
import { companyProfileSchema, loadProfile, saveProfile } from './companyProfile';
import { prepareDemo, sweepSandboxes } from '../demo/seed';

/**
 * One company per deployment. On boot we make sure the single organization row exists,
 * seed sensible scoring dimensions, optionally apply `company.config.json`, and optionally
 * create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD so a deployment can be fully
 * configured without touching the UI.
 */

export const DEFAULT_DIMENSIONS = [
  { name: 'Beat relevance', weight: 25, description: "How closely the journalist's beat matches our industry, products and story angles." },
  { name: 'Audience match', weight: 20, description: "How well the outlet's readers match our target audience." },
  { name: 'Recent coverage of similar companies', weight: 20, description: 'Whether they have recently covered our competitors or companies and topics like ours.' },
  { name: 'Geography', weight: 10, description: 'Whether they cover the regions we operate in or care about.' },
  { name: 'Outlet reach', weight: 15, description: "Reach and authority of the journalist's outlet." },
  { name: 'Responsiveness signals', weight: 10, description: 'Public signs they engage with pitches: published contact route, active on social, recent output.' },
] as const;

const configSchema = z.object({
  company: companyProfileSchema,
  scoringDimensions: z.array(z.object({
    name: z.string().trim().min(1),
    description: z.string().default(''),
    weight: z.number().int().min(0).max(100),
  })).optional(),
});

export async function ensureOrg(db: Pool | PoolClient = pool): Promise<string> {
  const { rows: [existing] } = await db.query('SELECT id FROM organizations WHERE demo_expires_at IS NULL ORDER BY created_at ASC LIMIT 1');
  if (existing) return existing.id;
  const { rows: [org] } = await db.query(
    `INSERT INTO organizations (name, slug) VALUES ('My Company', 'default') RETURNING id`,
  );
  return org.id;
}

export async function seedDimensions(
  orgId: string,
  dims: readonly { name: string; description: string; weight: number }[] = DEFAULT_DIMENSIONS,
  db: Pool | PoolClient = pool,
): Promise<boolean> {
  const { rows: [{ c }] } = await db.query('SELECT COUNT(*)::int AS c FROM scoring_dimensions WHERE org_id = $1', [orgId]);
  if (c > 0) return false;
  for (const [i, d] of dims.entries()) {
    await db.query(
      `INSERT INTO scoring_dimensions (org_id, name, description, weight, display_order) VALUES ($1, $2, $3, $4, $5)`,
      [orgId, d.name, d.description, d.weight, i],
    );
  }
  return true;
}

function findConfigFile(): string | null {
  const candidates = [
    process.env.COMPANY_CONFIG_PATH,
    path.resolve(process.cwd(), 'company.config.json'),
    path.resolve(process.cwd(), '..', 'company.config.json'),
  ].filter(Boolean) as string[];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

/**
 * Apply company.config.json. By default it only seeds a profile that doesn't exist yet, so
 * edits made under Company Profile are never overwritten on restart. Set COMPANY_CONFIG_SYNC=true
 * to treat the file as the source of truth on every boot.
 */
export async function applyConfigFile(orgId: string): Promise<'none' | 'applied' | 'skipped'> {
  const file = findConfigFile();
  if (!file) return 'none';

  // Checked before validating: a file that is not going to be used must not stop the server.
  const sync = process.env.COMPANY_CONFIG_SYNC === 'true';
  if (!sync && (await loadProfile(orgId))) return 'skipped';

  const parsed = configSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) {
    const detail = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid ${file}: ${detail}`);
  }

  await saveProfile(orgId, parsed.data.company);
  if (parsed.data.scoringDimensions) await seedDimensions(orgId, parsed.data.scoringDimensions);
  console.log(`[bootstrap] Applied company profile from ${file}`);
  return 'applied';
}

async function bootstrapAdminFromEnv(orgId: string): Promise<void> {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const { rows: [{ c }] } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM users u JOIN organizations o ON o.id = u.org_id WHERE o.demo_expires_at IS NULL');
  if (c > 0) return;
  if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  await pool.query(
    `INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'owner')`,
    [orgId, ADMIN_EMAIL.trim().toLowerCase(), await bcrypt.hash(ADMIN_PASSWORD, 12), ADMIN_NAME || 'Admin'],
  );
  console.log(`[bootstrap] Created admin ${ADMIN_EMAIL}`);
}

export async function bootstrap(): Promise<void> {
  // Public demo: visitors get their own sandbox at sign-in, so there is no company to set up.
  if (process.env.DEMO_MODE === 'true') {
    await prepareDemo();
    console.log('[bootstrap] DEMO_MODE: ready');
    return;
  }
  await sweepSandboxes(); // left over if this database was once a demo
  const orgId = await ensureOrg();
  await applyConfigFile(orgId);
  await seedDimensions(orgId);
  await bootstrapAdminFromEnv(orgId);
}
