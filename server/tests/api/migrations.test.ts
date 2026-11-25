import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDb, useTestApp } from '../setup/testDb';

/** Upgrading a database that already holds data written under the old, looser rules. */
describe.skipIf(!hasDb)('upgrade and rollback', () => {
  const name = `pdtest_${randomBytes(5).toString('hex')}`;
  const base = process.env.DATABASE_URL!;
  const admin = new Client({ connectionString: base });
  let db: Client;
  let url: string;
  const migrate = async (direction: 'up' | 'down', count: number) => {
    const { runner } = await import('node-pg-migrate');
    await runner({ databaseUrl: url, dir: path.resolve(__dirname, '../../migrations'), direction, count, migrationsTable: 'pgmigrations', log: () => {} });
  };
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(base); u.pathname = `/${name}`; url = u.toString();
    await migrate('up', 5);
    db = new Client({ connectionString: url });
    await db.connect();
  });
  afterAll(async () => { await db.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); });

  it('repairs old rows without losing any, and can be rolled back', async () => {
    const { rows: [org] } = await db.query(`INSERT INTO organizations (name, slug) VALUES ('Real', 'real') RETURNING id`);
    const user = (email: string) => db.query(`INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, '!', 'n', 'owner')`, [org.id, email]);
    for (const e of ['Mixed@Example.com', 'twin@example.com', 'Twin@example.com']) await user(e);
    const { rows: [d] } = await db.query(`INSERT INTO scoring_dimensions (org_id, name, weight) VALUES ($1, 'd', 10) RETURNING id`, [org.id]);
    const { rows: [j] } = await db.query(`INSERT INTO journalists (org_id, name, total_score, bio) VALUES ($1, 'j', 999, $2) RETURNING id`, [org.id, 'x'.repeat(9000)]);
    await db.query(`INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score) VALUES ($1, $2, $3, 25)`, [org.id, j.id, d.id]);
    const { rows: [big] } = await db.query(`INSERT INTO organizations (name, slug) VALUES ('Absurd', 'absurd') RETURNING id`);
    await db.query(`INSERT INTO scoring_dimensions (org_id, name, weight) VALUES ($1, 'x', 2000000000), ($1, 'y', 2000000000), ($1, 'z', -5)`, [big.id]);
    await db.query(`INSERT INTO journalists (org_id, name) VALUES ($1, 'absurd')`, [big.id]);
    await db.query(`INSERT INTO journalist_scores (org_id, journalist_id, dimension_id, score) SELECT j.org_id, j.id, d.id, 2000000000 FROM journalists j JOIN scoring_dimensions d ON d.org_id = j.org_id WHERE j.org_id = $1`, [big.id]);
    for (const t of ['a', 'b']) await db.query(`INSERT INTO invites (org_id, email, token, expires_at) VALUES ($1, 'i@example.com', $2, NOW() + INTERVAL '1 day')`, [org.id, t]);

    await db.query(`INSERT INTO publications (org_id, name, rss_url) VALUES ($1, 'Unscanned', 'https://u.example/rss'), ($1, 'Bare', 'b.example/rss'), ($1, 'None', '')`, [org.id]);
    await db.query(`INSERT INTO publication_feeds (org_id, publication_id, feed_url) SELECT org_id, id, rss_url FROM publications WHERE name = 'Bare'`);

    await migrate('up', Infinity);
    expect((await db.query('SELECT p.name, f.feed_url FROM publications p JOIN publication_feeds f ON f.publication_id = p.id ORDER BY p.name')).rows).toEqual([{ name: 'Bare', feed_url: 'https://b.example/rss' }, { name: 'Unscanned', feed_url: 'https://u.example/rss' }]);
    expect((await db.query('SELECT email FROM users ORDER BY email COLLATE "C"')).rows.map(r => r.email)).toEqual(['Twin@example.com', 'mixed@example.com', 'twin@example.com']);
    expect((await db.query(`SELECT total_score FROM journalists WHERE name = 'absurd'`)).rows).toEqual([{ total_score: 2000 }]);
    expect((await db.query(`SELECT total_score, LENGTH(bio) AS len FROM journalists WHERE name = 'j'`)).rows).toEqual([{ total_score: 10, len: 9000 }]);
    expect((await db.query(`SELECT COUNT(*)::int AS c FROM invites WHERE status = 'pending'`)).rows[0].c).toBe(1);

    await db.query(`INSERT INTO organizations (name, slug, demo_expires_at) VALUES ('Sandbox', 's', NOW())`);
    await migrate('down', 4);
    expect((await db.query('SELECT name FROM organizations ORDER BY created_at')).rows).toEqual([{ name: 'Real' }, { name: 'Absurd' }]); // no sandbox posing as real
    await migrate('up', Infinity);
    expect((await db.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c).toBe(3);
  });
});

describe.skipIf(!hasDb)('company.config.json', () => {
  const ctx = useTestApp();
  it('is not validated once a profile exists, and is when it is needed', async () => {
    const { applyConfigFile, ensureOrg } = await import('../../src/lib/bootstrap');
    const { saveProfile, emptyProfile } = await import('../../src/lib/companyProfile');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-')), 'company.config.json');
    fs.writeFileSync(file, JSON.stringify({ company: { name: 'X', products: 'x'.repeat(5000) } }));
    process.env.COMPANY_CONFIG_PATH = file;
    const orgId = await ensureOrg();
    await expect(applyConfigFile(orgId)).rejects.toThrow(/products/);
    await saveProfile(orgId, emptyProfile('Saved'), ctx.pool);
    expect(await applyConfigFile(orgId)).toBe('skipped');
    delete process.env.COMPANY_CONFIG_PATH;
  });
});
