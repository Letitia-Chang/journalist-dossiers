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

  it('signs in to an account stored with capitals, and prefers an exact match', async () => {
    const bcrypt = (await import('bcrypt')).default;
    const u = await makeUser(ctx, 'admin');
    await ctx.pool.query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', ['Bob@Example.com', await bcrypt.hash(PASSWORD, 4), u.id]);
    expect((await login('bob@example.com')).body.user?.id).toBe(u.id);
    const owner = await makeUser(ctx, 'owner', u.orgId);
    expect((await request(ctx.app).post('/api/team/invites').set(owner.auth).send({ email: 'bob@example.com' })).status).toBe(409);
    // An invite made before the account existed can't create its twin either.
    await ctx.pool.query(`INSERT INTO invites (org_id, email, token, expires_at) VALUES ($1, 'bob@example.com', $2, NOW() + INTERVAL '1 day')`, [u.orgId, 'b'.repeat(48)]);
    expect((await request(ctx.app).post('/api/auth/accept-invite').send({ token: 'b'.repeat(48), name: 'x', password: PASSWORD })).body.error).toMatch(/email already exists/);
    // Two old accounts that differ only by case: the spelling decides.
    await ctx.pool.query('DROP INDEX IF EXISTS users_email_lower_key');
    const twin = await makeUser(ctx, 'member', u.orgId);
    await ctx.pool.query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', ['bob@example.com', await bcrypt.hash('another-password', 4), twin.id]);
    expect((await login('Bob@Example.com')).body.user?.id).toBe(u.id);
    expect((await login('bob@example.com', 'another-password')).body.user?.id).toBe(twin.id);
    await ctx.pool.query('DELETE FROM users WHERE id = $1', [twin.id]);
    await ctx.pool.query('CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email))');
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
    for (const id of [owner.id, owner.id.toUpperCase()]) { // ids are compared as UUIDs, not text
      expect((await request(ctx.app).put(`/api/team/members/${id}/role`).set(owner.auth).send({ role: 'member' })).status).toBe(400);
      expect((await request(ctx.app).delete(`/api/team/members/${id}`).set(owner.auth)).status).toBe(400);
    }
  });

  it('two owners cannot demote or remove each other at the same time', async () => {
    for (const path of ['role', 'remove'] as const) {
      for (let i = 0; i < 8; i++) {
        const a = await makeUser(ctx, 'owner');
        const b = await makeUser(ctx, 'owner', a.orgId);
        const act = (who: typeof a, target: typeof a) => path === 'role'
          ? request(ctx.app).put(`/api/team/members/${target.id}/role`).set(who.auth).send({ role: 'member' })
          : request(ctx.app).delete(`/api/team/members/${target.id}`).set(who.auth);
        await Promise.all([act(a, b), act(b, a)]);
        expect((await ctx.pool.query(`SELECT 1 FROM users WHERE org_id = $1 AND role = 'owner'`, [a.orgId])).rowCount).toBe(1);
      }
    }
  });

  it('removing or demoting someone revokes the invites they sent or were sent', async () => {
    for (const how of ['remove', 'demote'] as const) {
      const owner = await makeUser(ctx, 'owner');
      const bad = await makeUser(ctx, 'owner', owner.orgId);
      const { body } = await request(ctx.app).post('/api/team/invites').set(bad.auth).send({ email: `${how}@example.com`, role: 'owner' });
      if (how === 'remove') await request(ctx.app).delete(`/api/team/members/${bad.id}`).set(owner.auth);
      else await request(ctx.app).put(`/api/team/members/${bad.id}/role`).set(owner.auth).send({ role: 'member' });
      expect((await request(ctx.app).post('/api/auth/accept-invite').send({ token: body.token, name: 'x', password: PASSWORD })).status).toBe(404);
    }
  });

  it('keeps one open invite per email, even when several are sent at once', async () => {
    const owner = await makeUser(ctx, 'owner');
    await Promise.all(Array.from({ length: 6 }, () => request(ctx.app).post('/api/team/invites').set(owner.auth).send({ email: 'dup@example.com' })));
    expect((await request(ctx.app).get('/api/team/invites').set(owner.auth)).body).toHaveLength(1);
  });

  it('first-run sign-up under a burst makes exactly one owner and no errors', async () => {
    const res = await Promise.all(Array.from({ length: 25 }, (_, i) => signup(`o${i}@example.com`)));
    expect(res.map(r => r.status).sort()).toEqual([201, ...Array(24).fill(403)]);
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
      for (let i = 0; i < 12; i++) expect((await from('198.51.100.7', PASSWORD)).status).toBe(200); // successes don't count
      // Guessing across many accounts from one address is limited too.
      const codes2 = [];
      for (let i = 0; i < 52; i++) codes2.push((await request(ctx.app).post('/api/auth/login').set('x-test-ip', '192.0.2.9').send({ email: `u${i}@example.com`, password: 'x' })).status);
      expect(codes2.filter(x => x === 429)).toHaveLength(2);
      // Rotating through one IPv6 /48 is limited per account, below the per-address limit.
      const codes3 = [];
      for (let i = 0; i < 32; i++) codes3.push((await from(`2001:db8:7:${i}::1`, 'wrong-password')).status);
      expect(codes3.filter(x => x === 429)).toHaveLength(2);
      // And none of it locks the owner out from somewhere else.
      expect((await from('198.51.100.8', PASSWORD)).status).toBe(200);
    } finally { delete process.env.CLIENT_IP_HEADER; delete process.env.TRUST_PROXY; }
  });

  it('a correct password returns exactly the attempt it used, in the window it used it', async () => {
    const R = await import('../../src/lib/rateLimit');
    const c = { bucket: 'x', windowMs: 60_000, limit: 10 };
    await R.take([c], 3, 1_000);
    await R.take([c], 2, 61_000);
    await R.giveBack([c], 1_000);
    expect(await R.remaining([c], 1_000)).toEqual([8]);
    expect(await R.remaining([c], 61_000)).toEqual([8]);
    for (let i = 0; i < 5; i++) await R.giveBack([c], 1_000);
    expect(await R.remaining([c], 1_000)).toEqual([10]); // never below zero used
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
