import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasDb, makeUser, useTestApp } from '../setup/testDb';

const PASSWORD = 'a-long-password';

describe.skipIf(!hasDb)('authentication', () => {
  const ctx = useTestApp();
  beforeEach(async () => { await ctx.pool.query('DELETE FROM organizations; DELETE FROM rate_limits;'); });
  const signup = (email: string) => request(ctx.app).post('/api/auth/signup').send({ name: 'O', email, password: PASSWORD });
  const login = (email: string, password = PASSWORD) => request(ctx.app).post('/api/auth/login').send({ email, password });
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('signs in regardless of the case used at sign-up', async () => {
    await signup(' Owner@Example.com ');
    for (const e of ['Owner@Example.com', 'owner@example.com', ' OWNER@EXAMPLE.COM ']) expect((await login(e)).status).toBe(200);
    expect((await login('owner@example.com', 'wrong-password')).status).toBe(401);
  });

  it('a removed member loses access at once', async () => {
    const owner = await makeUser(ctx, 'owner');
    const admin = await makeUser(ctx, 'admin', owner.orgId);
    expect((await request(ctx.app).get('/api/journalists').set(admin.auth)).status).toBe(200);
    expect((await request(ctx.app).delete(`/api/team/members/${admin.id}`).set(owner.auth)).status).toBe(204);
    expect((await request(ctx.app).get('/api/journalists').set(admin.auth)).status).toBe(401);
    expect((await request(ctx.app).post('/api/publications').set(admin.auth).send({ name: 'x' })).status).toBe(401);
  });

  it('a role change takes effect at once, in both directions', async () => {
    const owner = await makeUser(ctx, 'owner');
    const u = await makeUser(ctx, 'admin', owner.orgId);
    const create = () => request(ctx.app).post('/api/publications').set(u.auth).send({ name: 'x' });
    expect((await create()).status).toBe(201);
    await request(ctx.app).put(`/api/team/members/${u.id}/role`).set(owner.auth).send({ role: 'member' });
    expect((await create()).status).toBe(403);
    await request(ctx.app).put(`/api/team/members/${u.id}/role`).set(owner.auth).send({ role: 'admin' });
    expect((await create()).status).toBe(201);
  });

  it('only the owner manages the team, and the last owner cannot be removed', async () => {
    const owner = await makeUser(ctx, 'owner');
    for (const role of ['admin', 'member'] as const) {
      const u = await makeUser(ctx, role, owner.orgId);
      expect((await request(ctx.app).get('/api/team/invites').set(u.auth)).status).toBe(403);
      expect((await request(ctx.app).put(`/api/team/members/${u.id}/role`).set(u.auth).send({ role: 'owner' })).status).toBe(403);
      expect((await request(ctx.app).delete(`/api/team/members/${owner.id}`).set(u.auth)).status).toBe(403);
    }
    expect((await request(ctx.app).delete(`/api/team/members/${owner.id}`).set(owner.auth)).status).toBe(400);
    expect((await request(ctx.app).put(`/api/team/members/${owner.id}/role`).set(owner.auth).send({ role: 'member' })).status).toBe(400);
  });

  it('an invite works once', async () => {
    const owner = await makeUser(ctx, 'owner');
    const { body } = await request(ctx.app).post('/api/team/invites').set(owner.auth).send({ email: 'New@Example.com', role: 'admin' });
    const accept = () => request(ctx.app).post('/api/auth/accept-invite').send({ token: body.token, name: 'N', password: PASSWORD });
    const [a, b] = await Promise.all([accept(), accept()]);
    expect([a.status, b.status].filter(s => s === 201)).toHaveLength(1);
    expect((await accept()).status).toBeGreaterThanOrEqual(400);
    expect((await login('new@example.com')).body.user.role).toBe('admin');
  });

  it('rejects tokens that are forged, unsigned, expired, or meant for something else', async () => {
    const { signOAuthState } = await import('../../src/middleware/auth');
    const u = await makeUser(ctx);
    const claims = { sub: u.id, orgId: u.orgId, role: 'owner' };
    const secret = process.env.SESSION_SECRET!;
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    for (const t of [
      'not.a.token', none, jwt.sign(claims, 'other-secret'), jwt.sign(claims, secret, { expiresIn: -1 }), jwt.sign(claims, secret, { algorithm: 'HS512' }),
      signOAuthState(u.id, u.orgId), jwt.sign({ ...claims, sub: '00000000-0000-4000-8000-000000000000' }, secret),
    ]) expect((await request(ctx.app).get('/api/journalists').set(bearer(t))).status).toBe(401);
    // A token cannot claim a role the user does not have, or another organization.
    const member = await makeUser(ctx, 'member', u.orgId);
    expect((await request(ctx.app).post('/api/publications').set(bearer(jwt.sign({ sub: member.id, orgId: u.orgId, role: 'owner' }, secret))).send({ name: 'x' })).status).toBe(403);
    const other = await makeUser(ctx);
    expect((await request(ctx.app).get('/api/journalists').set(bearer(jwt.sign({ ...claims, orgId: other.orgId }, secret)))).status).toBe(401);
  });

  it('throttles password guessing without locking the owner out elsewhere', async () => {
    process.env.TRUST_PROXY = 'true';
    process.env.CLIENT_IP_HEADER = 'x-test-ip';
    try {
      await signup('owner@example.com');
      const from = (ip: string, password: string) => request(ctx.app).post('/api/auth/login').set('x-test-ip', ip).send({ email: 'owner@example.com', password });
      const codes = [];
      for (let i = 0; i < 12; i++) codes.push((await from('203.0.113.1', 'wrong-password')).status);
      expect(codes).toEqual([...Array(10).fill(401), 429, 429]);
      expect((await from('203.0.113.1', PASSWORD)).status).toBe(429);
      expect((await from('198.51.100.7', PASSWORD)).status).toBe(200);
    } finally { delete process.env.CLIENT_IP_HEADER; delete process.env.TRUST_PROXY; }
  });

  it('never puts a session token in the Gmail consent URL', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    const owner = await makeUser(ctx);
    const admin = await makeUser(ctx, 'admin', owner.orgId);
    expect((await request(ctx.app).post('/auth/google/start')).status).toBe(401);
    expect((await request(ctx.app).post('/auth/google/start').set(admin.auth)).status).toBe(403);
    const { body } = await request(ctx.app).post('/auth/google/start').set(owner.auth);
    const state = new URL(body.url).searchParams.get('state')!;
    expect(state).not.toBe(owner.auth.Authorization.slice(7));
    expect((await request(ctx.app).get('/api/journalists').set(bearer(state))).status).toBe(401);
    expect(new URL(body.url).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.compose');
  });

  it('the Gmail callback rejects session tokens, demoted owners and markup', async () => {
    const { signOAuthState } = await import('../../src/middleware/auth');
    const owner = await makeUser(ctx);
    const cb = (state: string) => request(ctx.app).get('/auth/google/callback').query({ code: 'c', state });
    expect((await cb(owner.auth.Authorization.slice(7))).status).toBe(401);
    expect((await request(ctx.app).get('/auth/google/callback?code[]=a&state[]=b')).status).toBe(400);
    const state = signOAuthState(owner.id, owner.orgId);
    await ctx.pool.query(`UPDATE users SET role = 'member' WHERE id = $1`, [owner.id]);
    const res = await cb(state);
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('refuses to start in production with a weak secret', async () => {
    const { assertSessionSecret } = await import('../../src/middleware/auth');
    const saved = { s: process.env.SESSION_SECRET, n: process.env.NODE_ENV };
    process.env.NODE_ENV = 'production';
    for (const weak of ['', 'change-me', 'short']) { process.env.SESSION_SECRET = weak; expect(() => assertSessionSecret()).toThrow(); }
    process.env.SESSION_SECRET = saved.s; process.env.NODE_ENV = saved.n;
    expect(() => assertSessionSecret()).not.toThrow();
  });
});
