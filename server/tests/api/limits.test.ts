import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
    const { vi } = await import('vitest');
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
    expect(R.normalizeIp('::1')).toBe('0:0:0:0::/64');
    await L.takeLiveAi('203.0.113.9', 1, T);
    const { rows } = await ctx.pool.query('SELECT bucket FROM rate_limits');
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
  });

  it('prunes old windows only', async () => {
    await ctx.pool.query(`INSERT INTO rate_limits VALUES ('old', NOW() - INTERVAL '4 days', 1), ('new', NOW(), 1)`);
    await R.pruneRateLimits();
    expect((await ctx.pool.query('SELECT bucket FROM rate_limits')).rows).toEqual([{ bucket: 'new' }]);
  });

  describe('over HTTP, with a stub Claude', () => {
    let stub: http.Server; let calls: string[] = []; let owner: TestUser; let journalistId: number; let campaignId: number;
    beforeAll(async () => {
      stub = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          calls.push(body);
          const dims = [...body.matchAll(/dimensionId\\": (\d+)/g)].map(m => Number(m[1]));
          const text = dims.length
            ? JSON.stringify({ scores: dims.map(d => ({ dimensionId: d, score: 5, rationale: 'r', evidence: [] })), reasoning: 'ok' })
            : '{"subject":"S","body":"B"}';
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
        });
      }).listen(0);
      process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
      process.env.ANTHROPIC_API_KEY = 'stub';
      owner = await makeUser(ctx);
      await request(ctx.app).post('/api/scoring-dimensions').set(owner.auth).send({ name: 'Fit', weight: 25 });
      journalistId = (await request(ctx.app).post('/api/journalists').set(owner.auth).send({ name: 'J' })).body.id;
      campaignId = (await request(ctx.app).post('/api/campaigns').set(owner.auth).send({ name: 'C', brief: 'b' })).body.id;
    });
    beforeEach(() => { calls = []; });
    afterAll(() => { stub.close(); });

    it('falls back to the saved analysis after the limit', async () => {
      const cached = [];
      for (let i = 0; i < 4; i++) cached.push((await request(ctx.app).post(`/api/journalists/${journalistId}/score`).set(owner.auth)).body.cached);
      expect(cached).toEqual([false, false, false, true]);
      expect(calls).toHaveLength(3);
    });

    it('does not spend a call on a journalist who is not in the campaign', async () => {
      const res = await request(ctx.app).post(`/api/campaigns/${campaignId}/journalists/${journalistId}/regenerate`).set(owner.auth).send({});
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
      expect((await L.liveAiStatus('::ffff:127.0.0.1')).remaining).toBe(3);
    });

    it('refuses an oversized prompt before calling Claude, even for data saved before the caps', async () => {
      await ctx.pool.query('UPDATE journalists SET bio = $1 WHERE id = $2', ['x'.repeat(200_000), journalistId]);
      const res = await request(ctx.app).post(`/api/journalists/${journalistId}/score`).set(owner.auth);
      expect(res.status).toBe(413);
      expect(calls).toHaveLength(0);
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
