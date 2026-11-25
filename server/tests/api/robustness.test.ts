import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

/**
 * Regression: a rejected async handler used to kill the process (Express 4), so one bad URL took
 * the server down. Every request here must get a 4xx, and the server must still answer afterwards.
 */
describe.skipIf(!hasDb)('API input handling', () => {
const ctx = useTestApp();
let owner: TestUser;
beforeAll(async () => { owner = await makeUser(ctx); });

describe('bad input never crashes or 500s the server', () => {

  const bad = ['abc', 'NaN', '0', '-1', '1.5', '2147483648', '99999999999', '%00', '1%20OR%201=1', "1'"];
  const paths = [
    '/api/journalists/:x', '/api/campaigns/:x', '/api/campaigns/:x/journalists', '/api/publications/:x',
    '/api/publications/:x/feeds', '/api/publications/:x/journalists', '/api/articles/journalist/:x',
    '/api/outreach/journalist/:x', '/api/coverage/:x',
  ];
  it.each(paths)('GET %s with a malformed id is a 404', async path => {
    for (const x of bad) {
      const res = await request(ctx.app).get(path.replace(':x', x)).set(owner.auth);
      expect([path, x, res.status]).toEqual([path, x, 404]);
    }
    expect((await request(ctx.app).get('/api/health')).status).toBe(200);
  });

  const writes: [string, string][] = [
    ['put', '/api/journalists/abc'], ['delete', '/api/journalists/abc'], ['post', '/api/journalists/abc/score'],
    ['put', '/api/campaigns/abc'], ['post', '/api/campaigns/abc/generate-drafts'], ['post', '/api/campaigns/1/journalists/abc/regenerate'],
    ['delete', '/api/outreach/abc'], ['put', '/api/articles/abc'], ['delete', '/api/coverage/abc'], ['put', '/api/scoring-dimensions/abc'],
    ['post', '/api/suggestions/abc/accept'], ['post', '/api/journalist-suggestions/abc/accept'], ['post', '/api/journalist-suggestions/scan/abc'],
    ['delete', '/api/publications/1/feeds/abc'], ['put', '/api/team/members/abc/role'], ['delete', '/api/team/members/abc'], ['delete', '/api/team/invites/abc'],
  ];
  it.each(writes)('%s %s is a 404', async (method, path) => {
    const res = await (request(ctx.app) as never as Record<string, (p: string) => request.Test>)[method](path).set(owner.auth).send({});
    expect(res.status).toBe(404);
  });

  it.each([
    ['/api/auth/invite/%00'], ['/api/auth/invite/abc'], ['/api/auth/invite/%E0%A4%A'],
  ])('unauthenticated GET %s is a 4xx', async path => {
    const res = await request(ctx.app).get(path);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it.each([
    ['/api/auth/login', { email: { a: 1 }, password: 'x' }],
    ['/api/auth/login', { email: 'a@b.co', password: ['x'] }],
    ['/api/auth/login', null],
    ['/api/auth/signup', { email: 'a@b.co', password: 12345678, name: 'x' }],
    ['/api/auth/accept-invite', { token: { a: 1 }, name: 'x', password: 'xxxxxxxx' }],
  ])('unauthenticated POST %s with the wrong types is a 400', async (path, body) => {
    expect((await request(ctx.app).post(path).send(body as object)).status).toBe(400);
  });

  it.each([
    ['/api/journalists', { name: 'a\u0000b' }], ['/api/journalists', { name: 'x', publicationId: 99999999 }],
    ['/api/journalists', { name: 'x', scores: [{ dimensionId: 99999999, score: 1 }] }],
    ['/api/journalists', { name: 'x', beats: 'not-an-array' }], ['/api/journalists', { name: 'x', twitter: 'javascript:alert(1)' }],
    ['/api/journalists', { name: 'x', twitter: 'java\tscript:alert(1)' }], ['/api/journalists', { name: 'x', email: 'a@b.co\r\nBcc: c@d.co' }],
    ['/api/campaigns', { name: 'a\u0000b' }], ['/api/campaigns', {}], ['/api/articles', { journalistId: 'abc', title: 't' }],
    ['/api/coverage', { title: 't', publishedAt: 'notadate' }], ['/api/coverage', { title: 't', publishedAt: '2026-02-31' }],
    ['/api/coverage', { title: 't', publishedAt: '2024-01-01T00:00:00+20:00' }], ['/api/coverage', { title: 't', journalistId: 99999999 }], ['/api/coverage', { title: 't', url: 'data:text/html,x' }],
    ['/api/outreach', { journalistId: 1 }], ['/api/scoring-dimensions', { name: 'x', weight: 1e12 }],
    ['/api/publications', { name: 'x', url: 'javascript:1' }], ['/api/publications/import-opml', { opml: '<opml/>' }],
  ])('POST %s %j is a 400', async (path, body) => {
    const res = await request(ctx.app).post(path).set(owner.auth).send(body);
    expect([res.status, typeof res.body.error]).toEqual([400, 'string']);
  });

  it('answers malformed JSON and oversized bodies without leaking internals', async () => {
    const malformed = await request(ctx.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect([malformed.status, malformed.body]).toEqual([400, { error: 'Malformed JSON' }]);
    const big = await request(ctx.app).post('/api/campaigns').set(owner.auth).send({ name: 'x', brief: 'x'.repeat(300_000) });
    expect([big.status, big.body]).toEqual([413, { error: 'Request is too large' }]);
  });

  it('does not read a large body from an anonymous caller', async () => {
    const res = await request(ctx.app).post('/api/publications/import-opml').send({ opml: 'x'.repeat(300_000) });
    expect(res.status).toBe(401);
  });

  it('refuses a disallowed browser origin with a 403, not a 500', async () => {
    expect((await request(ctx.app).get('/api/health').set('Origin', 'https://evil.example')).status).toBe(403);
  });

  it('hides the details of an unexpected database error', async () => {
    const original = ctx.pool.query;
    (ctx.pool as { query: unknown }).query = () => Promise.reject(new Error('secret: password authentication failed for user neondb_owner'));
    try {
      const res = await request(ctx.app).get('/api/setup/status');
      expect([res.status, res.body]).toEqual([500, { error: 'Internal server error' }]);
    } finally { (ctx.pool as { query: unknown }).query = original; }
    expect((await request(ctx.app).get('/api/setup/status')).status).toBe(200);
  });

  it('survives every database connection dropping, idle or in the middle of a transaction', async () => {
    await Promise.all(Array.from({ length: 5 }, () => ctx.pool.query('SELECT pg_sleep(0.05)'))); // leaves idle connections
    const db = await ctx.pool.connect();
    await db.query('BEGIN');
    expect(ctx.pool.idleCount).toBeGreaterThan(1);
    const { Client } = await import('pg');
    const killer = new Client({ connectionString: process.env.DATABASE_URL });
    await killer.connect();
    await killer.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    await new Promise(r => setTimeout(r, 200));
    await expect(db.query('SELECT 1')).rejects.toThrow(); // and no uncaught 'error' event, which would fail the run
    db.release(true);
    await killer.end();
    expect((await request(ctx.app).get('/api/journalists').set(owner.auth)).status).toBe(200);
  });

  it('a burst from one caller does not starve the connection pool', async () => {
    const id = (await request(ctx.app).post('/api/journalists').set(owner.auth).send({ name: 'x' })).body.id;
    const codes = (await Promise.all(Array.from({ length: 60 }, () => request(ctx.app).put(`/api/journalists/${id}`).set(owner.auth).send({ name: 'y' })))).map(r => r.status);
    expect(codes.filter(c => c !== 200)).toEqual([]);
  });

  it('says it is busy, not broken, when the database is unreachable', async () => {
    const original = ctx.pool.query;
    (ctx.pool as { query: unknown }).query = () => Promise.reject(new Error('timeout exceeded when trying to connect'));
    try { expect((await request(ctx.app).get('/api/setup/status')).status).toBe(503); } finally { (ctx.pool as { query: unknown }).query = original; }
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('every stored text field has a length cap', () => {
  const long = 'x'.repeat(20_000);
  it.each([
    ['post', '/api/journalists', { name: 'x', bio: long }], ['post', '/api/journalists', { name: long }], ['post', '/api/journalists', { name: 'x', beats: [long] }],
    ['post', '/api/campaigns', { name: 'x', brief: long }], ['put', '/api/campaign-styles/cold_intro', { instructions: long }],
    ['post', '/api/scoring-dimensions', { name: 'x', description: long }], ['post', '/api/publications', { name: 'x', focus: long }],
    ['put', '/api/company', { name: 'x', products: long }], ['put', '/api/company', { name: 'x', key_messages: Array(21).fill('m') }],
    ['put', '/api/company', { name: 'x', website: 'javascript:alert(1)' }],
  ])('%s %s', async (method, path, body) => {
    const res = await (request(ctx.app) as never as Record<string, (p: string) => request.Test>)[method](path).set(owner.auth).send(body);
    expect(res.status).toBe(400);
  });
});

describe('ordinary requests still work', () => {
  it('accepts what the client sends, including nulls, blanks and @handles', async () => {
    const j = await request(ctx.app).post('/api/journalists').set(owner.auth).send({
      name: 'Ana García-Núñez', publicationId: null, email: '', twitter: '@ana', linkedin: 'https://linkedin.com/in/ana', bio: 'Line 1\nLine 2', beats: ['AI'], photoUrl: '', scores: [],
    });
    expect(j.status).toBe(201);
    expect((await request(ctx.app).put(`/api/journalists/${j.body.id}`).set(owner.auth).send({ isFavorite: true })).status).toBe(200);
    const cov = await request(ctx.app).post('/api/coverage').set(owner.auth).send({ title: 't', url: '', notes: '', publishedAt: null, journalistId: j.body.id, campaignId: null });
    expect(cov.status).toBe(201);
    expect((await request(ctx.app).post('/api/coverage').set(owner.auth).send({ title: 't', publishedAt: '2026-11-24' })).status).toBe(201);
    expect((await request(ctx.app).post('/api/publications').set(owner.auth).send({ name: 'P', url: 'example.com:8080/x', tier: 'A', focus: '', notes: '', rssUrl: '' })).status).toBe(201);
    const opml = '<opml><body><outline title="Feed" xmlUrl="https://e.com/rss" htmlUrl="https://e.com"/></body></opml>';
    expect((await request(ctx.app).post('/api/publications/import-opml').set(owner.auth).send({ opml })).body).toMatchObject({ added: 1 });
  });
});
});
