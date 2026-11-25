import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

type Method = 'get' | 'post' | 'put' | 'delete';

describe.skipIf(!hasDb)('demo sandboxes', () => {
  const ctx = useTestApp();
  let seed: typeof import('../../src/demo/seed');
  beforeAll(async () => { seed = await import('../../src/demo/seed'); });
  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    await ctx.pool.query('DELETE FROM organizations; DELETE FROM rate_limits;');
  });
  afterAll(() => { process.env.DEMO_MODE = 'false'; });

  const enter = async (): Promise<TestUser> => {
    const res = await request(ctx.app).post('/api/auth/demo-login');
    expect(res.status).toBe(200);
    return { id: res.body.user.id, orgId: res.body.org.id, auth: { Authorization: `Bearer ${res.body.token}` } };
  };
  const call = (who: TestUser, method: Method, path: string, body?: object) => {
    const r = request(ctx.app)[method](path).set(who.auth);
    return body ? r.send(body) : r;
  };

  it('gives a complete, working copy of the fictional company', async () => {
    const a = await enter();
    const js = (await call(a, 'get', '/api/journalists')).body;
    expect(js).toHaveLength(10);
    for (const j of js) {
      expect(j.scores).toHaveLength(6);
      expect(j.total_score).toBe(j.scores.reduce((n: number, s: { score: number }) => n + s.score, 0));
    }
    const dash = (await call(a, 'get', '/api/dashboard')).body;
    expect(dash).toMatchObject({ totalJournalists: 10, activeCampaigns: 1, draftsReady: 8 });
    expect(dash.recentCoverage).toHaveLength(1);
    const [c] = (await call(a, 'get', '/api/campaigns')).body;
    expect((await call(a, 'post', `/api/campaigns/${c.id}/create-gmail-drafts`)).body.previews).toHaveLength(8);
    expect((await call(a, 'get', '/api/company')).body.profile.name).toBe('Lumen Grid');
  });

  it('keeps visitors apart: no read, write or link crosses a sandbox', async () => {
    const a = await enter();
    const b = await enter();
    const aJ = (await call(a, 'get', '/api/journalists')).body[0];
    const aC = (await call(a, 'get', '/api/campaigns')).body[0];
    const aP = (await call(a, 'get', '/api/publications')).body[0];
    const aArticle = (await call(a, 'get', `/api/articles/journalist/${aJ.id}`)).body[0];
    const aLog = (await call(a, 'get', '/api/outreach/activity')).body[0];
    const aCov = (await call(a, 'get', '/api/coverage')).body[0];
    const bJ = (await call(b, 'get', '/api/journalists')).body[0];
    const bC = (await call(b, 'get', '/api/campaigns')).body[0];
    const bCov = (await call(b, 'get', '/api/coverage')).body[0];
    const before = await ctx.pool.query('SELECT name, bio, total_score FROM journalists WHERE org_id = $1 ORDER BY id', [a.orgId]);

    const denied: [Method, string, object?][] = [
      ['get', `/api/journalists/${aJ.id}`], ['put', `/api/journalists/${aJ.id}`, { name: 'DEFACED' }], ['delete', `/api/journalists/${aJ.id}`],
      ['post', `/api/journalists/${aJ.id}/score`], ['get', `/api/campaigns/${aC.id}`], ['put', `/api/campaigns/${aC.id}`, { name: 'DEFACED' }],
      ['delete', `/api/campaigns/${aC.id}`], ['post', `/api/campaigns/${aC.id}/journalists`, { journalistIds: [bJ.id] }],
      ['delete', `/api/campaigns/${aC.id}/journalists/${aJ.id}`], ['post', `/api/campaigns/${aC.id}/generate-drafts`],
      ['post', `/api/campaigns/${aC.id}/journalists/${aJ.id}/regenerate`, {}], ['put', `/api/campaigns/${aC.id}/journalists/${aJ.id}/draft`, { draftBody: 'DEFACED' }],
      ['post', `/api/campaigns/${aC.id}/journalists/${aJ.id}/send`], ['post', `/api/campaigns/${aC.id}/create-gmail-drafts`],
      ['get', `/api/publications/${aP.id}`], ['get', `/api/publications/${aP.id}/journalists`], ['put', `/api/articles/${aArticle.id}`, { title: 'DEFACED' }],
      ['delete', `/api/articles/${aArticle.id}`], ['put', `/api/outreach/${aLog.id}`, { notes: 'DEFACED' }], ['delete', `/api/outreach/${aLog.id}`],
      ['get', `/api/coverage/${aCov.id}`], ['put', `/api/coverage/${aCov.id}`, { title: 'DEFACED' }], ['delete', `/api/coverage/${aCov.id}`],
      // Linking my row to yours would leak it back through a join.
      ['post', `/api/campaigns/${bC.id}/journalists`, { journalistIds: [aJ.id] }], ['post', '/api/journalists', { name: 'x', publicationId: aP.id }],
      ['put', `/api/journalists/${bJ.id}`, { publicationId: aP.id }], ['post', '/api/coverage', { title: 'x', journalistId: aJ.id }],
      ['post', '/api/coverage', { title: 'x', campaignId: aC.id }], ['post', '/api/outreach', { journalistId: aJ.id, type: 'note', status: 'Pitched' }],
      ['post', '/api/outreach', { journalistId: bJ.id, campaignId: aC.id, type: 'note', status: 'Pitched' }], ['post', '/api/articles', { journalistId: aJ.id, title: 'x' }],
      ['put', `/api/coverage/${bCov.id}`, { campaignId: aC.id }], ['put', `/api/coverage/${bCov.id}`, { journalistId: aJ.id }],
      ['put', `/api/journalists/${bJ.id}`, { scores: [{ dimensionId: aJ.scores[0].dimensionId, score: 1 }] }],
    ];
    for (const [method, path, body] of denied) {
      const res = await call(b, method, path, body);
      expect([method, path, [400, 403, 404].includes(res.status)]).toEqual([method, path, true]);
    }
    for (const path of [`/api/articles/journalist/${aJ.id}`, `/api/outreach/journalist/${aJ.id}`, `/api/campaigns/${aC.id}/journalists`, `/api/publications/${aP.id}/feeds`]) {
      expect((await call(b, 'get', path)).body).toEqual([]);
    }
    const after = await ctx.pool.query('SELECT name, bio, total_score FROM journalists WHERE org_id = $1 ORDER BY id', [a.orgId]);
    expect(after.rows).toEqual(before.rows);
    expect(JSON.stringify((await ctx.pool.query('SELECT * FROM campaign_journalists')).rows)).not.toContain('DEFACED');

    await call(b, 'put', `/api/journalists/${bJ.id}`, { name: 'MINE ONLY' });
    expect(JSON.stringify((await call(a, 'get', '/api/journalists')).body)).not.toContain('MINE ONLY');
    expect((await call(a, 'get', '/api/export/journalists')).text).not.toContain('MINE ONLY');
    expect((await call(b, 'get', '/api/team/members')).body).toHaveLength(1);
  });

  it('has no accounts: a visitor cannot sign up, log in or accept an invite', async () => {
    for (const [path, body] of [
      ['signup', { name: 'x', email: 'x@example.com', password: 'a-long-password' }],
      ['login', { email: 'x@example.com', password: 'a-long-password' }],
      ['accept-invite', { token: 'a'.repeat(48), name: 'x', password: 'a-long-password' }],
    ] as const) {
      for (const p of [path, path.toUpperCase(), `${path}/`]) expect((await request(ctx.app).post(`/api/auth/${p}`).send(body)).status).toBe(403);
    }
    expect((await ctx.pool.query('SELECT 1 FROM users')).rowCount).toBe(0);
    expect((await request(ctx.app).get('/api/setup/status')).body).toMatchObject({ demo: true, needsAdmin: false, needsProfile: false, brand: { companyName: 'Lumen Grid' } });
  });

  it('visitors are members: settings, team and discovery stay closed', async () => {
    const a = await enter();
    const status = async (m: Method, p: string, b?: object) => (await call(a, m, p, b)).status;
    expect(await status('put', '/api/company', { name: 'x' })).toBe(403);
    expect(await status('post', '/api/team/invites', { email: 'x@example.com' })).toBe(403);
    expect(await status('post', '/api/scoring-dimensions', { name: 'x' })).toBe(403);
    expect(await status('post', '/api/publications', { name: 'x' })).toBe(403);
    expect(await status('post', '/api/journalist-suggestions/scan-all')).toBe(403);
    expect(await status('post', '/api/suggestions/run-now')).toBe(403);
  });

  it('limits sandboxes and writes per visitor', async () => {
    for (let i = 0; i < 10; i++) await enter();
    const res = await request(ctx.app).post('/api/auth/demo-login');
    expect([res.status, typeof res.body.error]).toEqual([429, 'string']);

    // Rotating through one /48 shares a network limit.
    process.env.CLIENT_IP_HEADER = 'x-test-ip';
    try {
      await ctx.pool.query('DELETE FROM rate_limits');
      const codes = [];
      for (let i = 0; i < 22; i++) codes.push((await request(ctx.app).post('/api/auth/demo-login').set('x-test-ip', `2001:db8:1:${i}::1`)).status);
      expect(codes).toEqual([...Array(20).fill(200), 429, 429]);
    } finally { delete process.env.CLIENT_IP_HEADER; }

    await ctx.pool.query('DELETE FROM rate_limits');
    const a = await enter();
    for (const bucket of ['write:%', 'write-org:%', 'write-all']) {
      expect((await call(a, 'post', '/api/campaigns', { name: 'c' })).status).toBe(201);
      await ctx.pool.query(`UPDATE rate_limits SET count = 1000000 WHERE bucket LIKE $1`, [bucket]);
      expect((await call(a, 'post', '/api/campaigns', { name: 'c' })).status).toBe(429);
      await ctx.pool.query(`DELETE FROM rate_limits`);
    }
    expect((await call(a, 'get', '/api/campaigns')).status).toBe(200); // reading still works
  });

  it('sweeps expired sandboxes but never a real organization', async () => {
    const a = await enter();
    const b = await enter();
    await ctx.pool.query(`UPDATE organizations SET demo_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [a.orgId]);
    process.env.DEMO_MODE = 'false';
    const real = await makeUser(ctx);
    await seed.sweepSandboxes();
    expect((await ctx.pool.query('SELECT id FROM organizations')).rows.map(r => r.id).sort()).toEqual([b.orgId, real.orgId].sort());
  });

  it('when full, drops the oldest sandboxes, but never recent ones or a real organization', async () => {
    process.env.DEMO_MODE = 'false';
    const real = await makeUser(ctx);
    await ctx.pool.query(`UPDATE organizations SET created_at = NOW() - INTERVAL '1 year' WHERE id = $1`, [real.orgId]);
    process.env.DEMO_MODE = 'true';
    const fill = (n: number, age: string, tag: string) => ctx.pool.query(
      `INSERT INTO organizations (name, slug, demo_expires_at, created_at) SELECT 'x', $3 || g, NOW() + INTERVAL '1 hour', NOW() - $2::interval FROM generate_series(1, $1) g`, [n, age, tag]);
    await fill(seed.MAX_SANDBOXES - 1, '10 minutes', 'new');
    await fill(5, '5 hours', 'old');
    expect(await seed.makeRoomForSandbox()).toBe(true);
    const left = (await ctx.pool.query('SELECT slug FROM organizations WHERE demo_expires_at IS NOT NULL')).rows.map(r => r.slug as string);
    expect(left).toHaveLength(seed.MAX_SANDBOXES - 1);
    expect(left.every(s => s.startsWith('new'))).toBe(true);

    await fill(1, '10 minutes', 'last'); // now full, and everyone is active
    expect((await request(ctx.app).post('/api/auth/demo-login')).status).toBe(503);
    expect((await ctx.pool.query('SELECT 1 FROM organizations WHERE demo_expires_at IS NOT NULL')).rowCount).toBe(seed.MAX_SANDBOXES);
    expect((await ctx.pool.query('SELECT 1 FROM organizations WHERE id = $1', [real.orgId])).rowCount).toBe(1);
  });

  it('a sandbox token stops working when the sandbox expires or demo mode is turned off', async () => {
    const a = await enter();
    process.env.DEMO_MODE = 'false';
    expect((await call(a, 'get', '/api/journalists')).status).toBe(401);
    process.env.DEMO_MODE = 'true';
    expect((await call(a, 'get', '/api/journalists')).status).toBe(200);
    await ctx.pool.query(`UPDATE organizations SET demo_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [a.orgId]);
    expect((await call(a, 'get', '/api/journalists')).status).toBe(401);
  });

  it('demo:reset deletes sandboxes and only sandboxes', async () => {
    await enter();
    await seed.resetDemo();
    expect((await ctx.pool.query('SELECT 1 FROM organizations')).rowCount).toBe(0);
    // Even if the safety check were bypassed, the delete itself is limited to sandboxes.
    await enter();
    const real = await makeUser(ctx);
    await seed.deleteAllSandboxes();
    expect((await ctx.pool.query('SELECT id FROM organizations')).rows).toEqual([{ id: real.orgId }]);
  });

  it('keeps an old shared demo company that someone put to real use', async () => {
    const legacy = '00000000-0000-4000-8000-0000000000d1';
    await ctx.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Lumen Grid', 'lumen-grid')`, [legacy]);
    const owner = await makeUser(ctx, 'owner', legacy);
    await expect(seed.prepareDemo()).rejects.toThrow(/real organization/);
    expect((await ctx.pool.query('SELECT 1 FROM users WHERE id = $1', [owner.id])).rowCount).toBe(1);
  });

  it('web discovery and paid research stay off in the demo, whatever the role', async () => {
    const a = await enter();
    await ctx.pool.query(`UPDATE users SET role = 'owner' WHERE id = $1`, [a.id]);
    const pub = (await call(a, 'get', '/api/publications')).body[0].id;
    for (const p of ['/api/suggestions/run-now', '/api/journalist-suggestions/scan-all', `/api/journalist-suggestions/scan/${pub}`, `/api/journalist-suggestions/staff-scan/${pub}`,
      '/api/publications/discover', '/api/publications/check-feeds', '/api/publications/sync-feeds', `/api/publications/${pub}/discover-rss`, `/api/publications/${pub}/discover-feeds`]) {
      const res = await call(a, 'post', p, { query: 'x' });
      expect([p, res.status, res.body.error]).toEqual([p, 403, expect.stringMatching(/disabled in the demo/)]);
    }
  });

  it('refuses to start, or reset, on a database with a real organization', async () => {
    process.env.DEMO_MODE = 'false';
    const real = await makeUser(ctx);
    await expect(seed.prepareDemo()).rejects.toThrow(/real organization/);
    await expect(seed.resetDemo()).rejects.toThrow(/real organization/);
    expect((await ctx.pool.query('SELECT 1 FROM organizations WHERE id = $1', [real.orgId])).rowCount).toBe(1);
  });

  it('a restart keeps sandboxes and removes the old shared demo company', async () => {
    const a = await enter();
    await ctx.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Lumen Grid', 'lumen-grid')`);
    await seed.prepareDemo();
    expect((await ctx.pool.query('SELECT id FROM organizations')).rows).toEqual([{ id: a.orgId }]);
    expect((await call(a, 'get', '/api/journalists')).body).toHaveLength(10);
  });

  it('leaves nothing behind when creation fails half way', async () => {
    const spy = vi.spyOn(Math, 'ceil').mockImplementation(() => { throw new Error('boom'); });
    expect((await request(ctx.app).post('/api/auth/demo-login')).status).toBe(500);
    spy.mockRestore();
    expect((await ctx.pool.query('SELECT 1 FROM organizations')).rowCount).toBe(0);
  });

  it('leftover sandboxes do not confuse a real deployment', async () => {
    await enter();
    process.env.DEMO_MODE = 'false';
    expect((await request(ctx.app).post('/api/auth/demo-login')).status).toBe(404);
    expect((await request(ctx.app).get('/api/setup/status')).body).toMatchObject({ demo: false, needsAdmin: true });
    const res = await request(ctx.app).post('/api/auth/signup').send({ name: 'Owner', email: 'o@example.com', password: 'a-long-password' });
    expect(res.status).toBe(201);
    const { rows: [org] } = await ctx.pool.query('SELECT demo_expires_at FROM organizations WHERE id = $1', [res.body.org.id]);
    expect(org.demo_expires_at).toBeNull();
  });
});
