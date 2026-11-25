import { randomBytes } from 'crypto';
import path from 'path';
import { Client } from 'pg';

/**
 * Integration tests never touch the database in DATABASE_URL. They only use that server to create
 * a migrated template database, which each test file clones and drops (see testDb.ts).
 */
export default async function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    if (process.env.CI) throw new Error('DATABASE_URL is required in CI: the integration tests must not be skipped.');
    console.warn('\n[tests] DATABASE_URL is not set: skipping the integration tests.\n');
    return;
  }
  const host = new URL(base).hostname;
  if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== 'true') {
    throw new Error(`[tests] Refusing to create test databases on "${host}". Use a local Postgres.`);
  }

  const template = `pdtest_tmpl_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${template}`);

  const url = new URL(base);
  url.pathname = `/${template}`;
  const { runner } = await import('node-pg-migrate');
  await runner({
    databaseUrl: url.toString(), dir: path.resolve(__dirname, '../../migrations'),
    direction: 'up', migrationsTable: 'pgmigrations', log: () => {},
  });
  process.env.TEST_DB_TEMPLATE = template;

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
    await admin.end();
  };
}
