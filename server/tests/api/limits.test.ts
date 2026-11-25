import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startClaudeStub, type ClaudeStub } from '../setup/claudeStub';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

const HOUR = 3_600_000;
const T = Date.UTC(2026, 0, 1, 12);

describe.skipIf(!hasDb)('durable demo limits', () => {
  const ctx = useTestApp();
  let L: typeof import('../../src/demo/limits');
  let R: typeof import('../../src/lib/rateLimit');

  beforeAll(async () => {
    L = await import('../../src/demo/limits');
    R = await import('../../src/lib/rateLimit');
  });
  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_AI_PER_HOUR = '3';
    process.env.DEMO_AI_PER_DAY = '5';
    await ctx.pool.query('DELETE FROM rate_limits');
  });
  afterAll(() => { process.env.DEMO_MODE = 'false'; });

  it('is unlimited outside demo mode', async () => {
    process.env.DEMO_MODE = 'false';
    expect(await L.takeLiveAi('a', 1000)).toBe(1000);
    expect((await L.liveAiStatus('a')).remaining).toBe(Infinity);
  });

  it('grants up to the hourly limit per visitor, then refuses until the next hour', async () => {
    for (const want of [1, 1, 1, 0]) expect(await L.takeLiveAi('a', 1, T)).toBe(want);
    expect(await L.liveAiStatus('a', T)).toEqual({ remaining: 0, limit: 'hour' });
    expect(await L.takeLiveAi('b', 1, T)).toBe(1); // independent visitor
    expect(await L.takeLiveAi('a', 1, T + HOUR)).toBe(1);
  });

  it('grants a partial batch and enforces the daily cap across visitors', async () => {
    expect(await L.takeLiveAi('a', 10, T)).toBe(3);
    expect(await L.takeLiveAi('b', 3, T)).toBe(2);
    expect(await L.liveAiStatus('c', T)).toEqual({ remaining: 0, limit: 'day' });
    expect(await L.takeLiveAi('c', 1, T + 24 * HOUR)).toBe(1);
  });

  it('never over-grants under concurrency', async () => {
    const grants = await Promise.all(Array.from({ length: 40 }, (_, i) => L.takeLiveAi(`v${i % 8}`, 1, T)));
    expect(grants.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('survives a restart: a fresh copy of the module sees the same counts', async () => {
    await L.takeLiveAi('a', 3, T);
    vi.resetModules();
    const fresh = await import('../../src/demo/limits');
    expect(await fresh.takeLiveAi('a', 1, T)).toBe(0);
    await (await import('../../src/db')).default.end();
  });

  it('treats a bad limit setting as the default, not as unlimited', async () => {
    process.env.DEMO_AI_PER_HOUR = 'five';
    process.env.DEMO_AI_PER_DAY = '-1';
    expect(await L.takeLiveAi('a', 100, T)).toBe(5);
  });

  it('fails closed when the counter cannot be read', async () => {
    await ctx.pool.query('ALTER TABLE rate_limits RENAME TO rate_limits_gone');
    await expect(L.takeLiveAi('a', 1, T)).rejects.toThrow();
    await ctx.pool.query('ALTER TABLE rate_limits_gone RENAME TO rate_limits');
  });

  it('groups IPv6 visitors by /64 and stores no addresses', async () => {
    expect(R.normalizeIp('2001:db8:1:2::1')).toBe(R.normalizeIp('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
    expect(R.normalizeIp('2001:db8:1:2::1')).not.toBe(R.normalizeIp('2001:db8:1:3::1'));
    expect(R.normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(R.normalizeIp('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(R.normalizeIp('0:0:0:0:0:ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(R.normalizeIp('::1')).toBe('0:0:0:0::/64');
    expect(R.networkOf('2001:db8:1:2::1')).toBe(R.networkOf('2001:db8:1:ff::1'));
    await L.takeLiveAi('203.0.113.9', 1, T);
    const { rows } = await ctx.pool.query('SELECT bucket FROM rate_limits');
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
  });

  it('does not deadlock when callers list the same counters in different orders', async () => {
    const a = { bucket: 'a', windowMs: HOUR, limit: 1000 };
    const b = { bucket: 'b', windowMs: HOUR, limit: 1000 };
    let deadlocks = 0;
    const query = ctx.pool.query.bind(ctx.pool);
    const before = (await query('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()')).rows[0].deadlocks;
    await Promise.all(Array.from({ length: 60 }, (_, i) => R.take(i % 2 ? [a, b] : [b, a], 1, T).catch(() => { deadlocks++; })));
    expect(deadlocks).toBe(0);
    await query('SELECT pg_stat_force_next_flush()').catch(() => {});
    expect((await query('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()')).rows[0].deadlocks).toBe(before);
    expect((await R.remaining([a, b], T))).toEqual([940, 940]);
  });

  it('prunes old windows only', async () => {
    await ctx.pool.query(`INSERT INTO rate_limits VALUES ('old', NOW() - INTERVAL '4 days', 1), ('new', NOW(), 1)`);
    await R.pruneRateLimits();
    expect((await ctx.pool.query('SELECT bucket FROM rate_limits')).rows).toEqual([{ bucket: 'new' }]);
  });

  describe('over HTTP, with a stub Claude', () => {
    let stub: ClaudeStub; let owner: TestUser; let journalistId: number; let campaignId: number;
    beforeAll(async () => {
      stub = await startClaudeStub();
      owner = await makeUser(ctx);
      await request(ctx.app).post('/api/scoring-dimensions').set(owner.auth).send({ name: 'Fit', weight: 25 });
      journalistId = (await request(ctx.app).post('/api/journalists').set(owner.auth).send({ name: 'J' })).body.id;
      campaignId = (await request(ctx.app).post('/api/campaigns').set(owner.auth).send({ name: 'C', brief: 'b' })).body.id;
    });
    beforeEach(() => { stub.calls.length = 0; stub.fail = false; });
    afterAll(() => { stub.close(); });

    it('falls back to the saved analysis after the limit', async () => {
      const cached = [];
      for (let i = 0; i < 4; i++) cached.push((await request(ctx.app).post(`/api/journalists/${journalistId}/score`).set(owner.auth)).body.cached);
      expect(cached).toEqual([false, false, false, true]);
      expect(stub.calls).toHaveLength(3);
    });

    it('counts one call per draft, for generating and regenerating, and stops at the limit', async () => {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push((await request(ctx.app).post('/api/journalists').set(owner.auth).send({ name: `D${i}` })).body.id);
      await request(ctx.app).post(`/api/campaigns/${campaignId}/journalists`).set(owner.auth).send({ journalistIds: ids });
      const gen = await request(ctx.app).post(`/api/campaigns/${campaignId}/generate-drafts`).set(owner.auth);
      expect(gen.body.message).toMatch(/Generating drafts for 3 .*1 left for later/);
      await vi.waitFor(async () => {
        const rows = (await request(ctx.app).get(`/api/campaigns/${campaignId}/journalists`).set(owner.auth)).body;
        expect(rows.filter((r: { status: string }) => r.status === 'ready')).toHaveLength(3);
        expect(rows.find((r: { draft_subject: string }) => r.draft_subject).draft_subject).toBe('New subject'); // one line
      });
      expect(stub.calls).toHaveLength(3);
      expect((await request(ctx.app).post(`/api/campaigns/${campaignId}/journalists/${ids[0]}/regenerate`).set(owner.auth).send({})).status).toBe(429);
      expect((await request(ctx.app).post(`/api/campaigns/${campaignId}/generate-drafts`).set(owner.auth)).status).toBe(429);
      expect(stub.calls).toHaveLength(3);
    });

    it('a failing Claude call is one request, never retried in the demo', async () => {
      stub.fail = true;
      expect((await request(ctx.app).post(`/api/journalists/${journalistId}/score`).set(owner.auth)).status).toBe(502);
      expect(stub.calls).toHaveLength(1);
    });

    it('refuses an oversized draft prompt and marks the draft failed', async () => {
      const c = (await request(ctx.app).post('/api/campaigns').set(owner.auth).send({ name: 'Big', brief: 'b' })).body.id;
      const j = (await request(ctx.app).post('/api/journalists').set(owner.auth).send({ name: 'Big' })).body.id;
      await request(ctx.app).post(`/api/campaigns/${c}/journalists`).set(owner.auth).send({ journalistIds: [j] });
      await ctx.pool.query('UPDATE campaigns SET brief = $1 WHERE id = $2', ['x'.repeat(200_000), c]);
      expect((await request(ctx.app).post(`/api/campaigns/${c}/journalists/${j}/regenerate`).set(owner.auth).send({})).status).toBe(413);
      await request(ctx.app).post(`/api/campaigns/${c}/generate-drafts`).set(owner.auth);
      await vi.waitFor(async () => expect((await request(ctx.app).get(`/api/campaigns/${c}/journalists`).set(owner.auth)).body[0].status).toBe('failed'));
      expect(stub.calls).toHaveLength(0);
    });

    it('does not spend a call on a journalist who is not in the campaign', async () => {
      const res = await request(ctx.app).post(`/api/campaigns/${campaignId}/journalists/${journalistId}/regenerate`).set(owner.auth).send({});
      expect(res.status).toBe(404);
      expect(stub.calls).toHaveLength(0);
      expect((await L.liveAiStatus('::ffff:127.0.0.1')).remaining).toBe(3);
    });

    it('refuses an oversized prompt before calling Claude, even for data saved before the caps', async () => {
      await ctx.pool.query('UPDATE journalists SET bio = $1 WHERE id = $2', ['x'.repeat(200_000), journalistId]);
      const res = await request(ctx.app).post(`/api/journalists/${journalistId}/score`).set(owner.auth);
      expect(res.status).toBe(413);
      expect(stub.calls).toHaveLength(0);
    });
  });
});

describe('limit messages', () => {
  it('explain which limit was hit', async () => {
    process.env.DEMO_AI_PER_HOUR = '3';
    const { limitMessage } = await import('../../src/demo/limits');
    expect(limitMessage({ remaining: 0, limit: 'hour' })).toMatch(/3 runs per hour/);
    expect(limitMessage({ remaining: 0, limit: 'day' })).toMatch(/today/);
  });
});
