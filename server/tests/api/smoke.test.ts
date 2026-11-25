import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hasDb, useTestApp } from '../setup/testDb';

describe.skipIf(!hasDb)('API smoke test', () => {
  const ctx = useTestApp();

  it('answers the health check', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('rejects unauthenticated requests to protected routes', async () => {
    for (const path of ['/api/journalists', '/api/company', '/api/campaigns']) {
      expect((await request(ctx.app).get(path)).status).toBe(401);
    }
  });

  it('rejects a forged token', async () => {
    const res = await request(ctx.app).get('/api/journalists').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('reports setup status, and walks first-run setup on a fresh database', async () => {
    const status = await request(ctx.app).get('/api/setup/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ demo: false, brand: { appName: expect.any(String) } });

    expect(status.body.needsAdmin).toBe(true);

    const email = `owner-${Date.now()}@example.com`;
    const signup = await request(ctx.app).post('/api/auth/signup').send({ name: 'Test Owner', email, password: 'a-long-password' });
    expect(signup.status).toBe(201);
    const auth = { Authorization: `Bearer ${signup.body.token}` };

    const second = await request(ctx.app).post('/api/auth/signup').send({ name: 'Second', email: 'x@example.com', password: 'a-long-password' });
    expect(second.status).toBe(403); // first-run only

    const invalid = await request(ctx.app).put('/api/company').set(auth).send({ name: '', brand_color: 'red' });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.fields)).toEqual(expect.arrayContaining(['name', 'brand_color']));

    const saved = await request(ctx.app).put('/api/company').set(auth).send({ name: 'Smoke Test Co', one_liner: 'Testing.' });
    expect(saved.status).toBe(200);
    expect(saved.body.profile.name).toBe('Smoke Test Co');

    const after = await request(ctx.app).get('/api/setup/status');
    expect(after.body).toMatchObject({ needsAdmin: false, needsProfile: false });

    const dims = await request(ctx.app).get('/api/scoring-dimensions').set(auth);
    expect(dims.body.length).toBeGreaterThan(0); // defaults were seeded
    expect(dims.body.reduce((n: number, d: { weight: number }) => n + d.weight, 0)).toBe(100);
  });
});
