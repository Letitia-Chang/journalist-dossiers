import { randomBytes, randomUUID } from 'crypto';
import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';

export const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_DB_TEMPLATE;

type App = typeof import('../../src/app')['app'];
export interface Ctx { app: App; pool: typeof import('../../src/db')['default'] }

/** Give this test file its own database. Import the app only after DATABASE_URL points at it. */
export function useTestApp(): Ctx {
  const ctx = {} as Ctx;
  if (!hasDb) return ctx;
  const name = `pdtest_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${process.env.TEST_DB_TEMPLATE}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    ctx.pool = (await import('../../src/db')).default;
    ctx.app = (await import('../../src/app')).app;
  });
  afterAll(async () => {
    await ctx.pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });
  return ctx;
}

export interface TestUser { id: string; orgId: string; auth: { Authorization: string } }

/** Insert a user (and an organization, unless one is given) and sign a token for them. */
export async function makeUser(ctx: Ctx, role: 'owner' | 'admin' | 'member' = 'owner', orgId?: string): Promise<TestUser> {
  const { signToken } = await import('../../src/middleware/auth');
  if (!orgId) {
    const { rows: [org] } = await ctx.pool.query(`INSERT INTO organizations (name, slug) VALUES ('Test Co', $1) RETURNING id`, [randomUUID()]);
    orgId = org.id as string;
  }
  const { rows: [user] } = await ctx.pool.query(
    `INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, '!', 'Test User', $3) RETURNING id`,
    [orgId, `${randomUUID()}@example.com`, role],
  );
  return { id: user.id, orgId, auth: { Authorization: `Bearer ${signToken({ sub: user.id, orgId, role })}` } };
}
