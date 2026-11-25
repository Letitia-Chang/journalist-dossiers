import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

describe.skipIf(!hasDb)('data integrity', () => {
  const ctx = useTestApp();
  let o: TestUser;
  const api = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: object) => { const r = request(ctx.app)[m](p).set(o.auth); return b ? r.send(b) : r; };
  beforeEach(async () => { o = await makeUser(ctx); });

  describe('scores', () => {
    let d1: number; let d2: number; let j: number;
    beforeEach(async () => {
      d1 = (await api('post', '/api/scoring-dimensions', { name: 'Beat', weight: 25, displayOrder: 1 })).body.id;
      d2 = (await api('post', '/api/scoring-dimensions', { name: 'Reach', weight: 15, displayOrder: 0 })).body.id;
      j = (await api('post', '/api/journalists', { name: 'J', scores: [{ dimensionId: d1, score: 20 }, { dimensionId: d2, score: 10 }] })).body.id;
    });
    const get = async () => (await api('get', `/api/journalists/${j}`)).body;

    it('rejects a score above the maximum and changes nothing', async () => {
      const res = await api('put', `/api/journalists/${j}`, { name: 'CHANGED', scores: [{ dimensionId: d2, score: 5 }, { dimensionId: d1, score: 26 }] });
      expect([res.status, res.body.error]).toEqual([400, 'Beat can be at most 25']);
      expect(await get()).toMatchObject({ name: 'J', total_score: 30 });
    });
    it('keeps the total right when a dimension is deleted', async () => {
      expect((await api('delete', `/api/scoring-dimensions/${d1}`)).status).toBe(204);
      expect(await get()).toMatchObject({ total_score: 10 });
    });
    it('clamps saved scores and the total when a maximum is lowered', async () => {
      await api('put', `/api/scoring-dimensions/${d1}`, { weight: 12 });
      expect(await get()).toMatchObject({ total_score: 22 });
    });
    it('drops the AI rationale only for scores changed by hand', async () => {
      await ctx.pool.query(`UPDATE journalist_scores SET rationale = 'why', evidence = '["https://e.example"]' WHERE journalist_id = $1`, [j]);
      await api('put', `/api/journalists/${j}`, { scores: [{ dimensionId: d1, score: 21 }, { dimensionId: d2, score: 10 }] });
      const by = Object.fromEntries((await get()).scores.map((s: { dimensionId: number }) => [s.dimensionId, s]));
      expect(by[d1]).toMatchObject({ score: 21, rationale: '', evidence: [] });
      expect(by[d2]).toMatchObject({ score: 10, rationale: 'why', evidence: ['https://e.example'] });
    });
    it('returns scores in display order', async () => {
      expect((await get()).scores.map((s: { dimensionId: number }) => s.dimensionId)).toEqual([d2, d1]);
    });
  });

  describe('sent pitches', () => {
    let c: number; let j: number;
    beforeEach(async () => {
      j = (await api('post', '/api/journalists', { name: 'J', email: 'j@example.com' })).body.id;
      c = (await api('post', '/api/campaigns', { name: 'C', brief: 'b' })).body.id;
      expect((await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: [j, j] })).body).toEqual({ added: 1 });
      await api('put', `/api/campaigns/${c}/journalists/${j}/draft`, { draftSubject: 'S', draftBody: 'B' });
    });
    const p = () => `/api/campaigns/${c}/journalists/${j}`;

    it('a double click logs one pitch', async () => {
      const codes = (await Promise.all([api('post', `${p()}/send`), api('post', `${p()}/send`), api('post', `${p()}/send`)])).map(r => r.status).sort();
      expect(codes).toEqual([200, 409, 409]);
      expect((await api('get', `/api/outreach/journalist/${j}`)).body).toHaveLength(1);
    });
    it('a sent pitch cannot be rewritten or regenerated, and stays sent', async () => {
      await api('post', `${p()}/send`);
      expect((await api('put', `${p()}/draft`, { draftBody: 'changed' })).status).toBe(409);
      expect((await api('post', `${p()}/regenerate`, {})).status).toBe(409);
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body[0]).toMatchObject({ status: 'sent', draft_body: 'B' });
    });
    it('a journalist who is not in the campaign is still a 404', async () => {
      expect((await api('post', `/api/campaigns/${c}/journalists/${j + 999}/send`)).status).toBe(404);
      expect((await api('put', `/api/campaigns/${c}/journalists/${j + 999}/draft`, { draftBody: 'x' })).status).toBe(404);
    });
  });

  it('null clears a link and leaving it out keeps it', async () => {
    const pub = (await api('post', '/api/publications', { name: 'P' })).body.id;
    const j = (await api('post', '/api/journalists', { name: 'J', publicationId: pub })).body.id;
    expect((await api('put', `/api/journalists/${j}`, { isFavorite: true })).body.publication_id).toBe(pub);
    expect((await api('put', `/api/journalists/${j}`, { publicationId: null })).body.publication_id).toBeNull();
    const cov = (await api('post', '/api/coverage', { title: 't', journalistId: j, publishedAt: '2026-01-02' })).body.id;
    expect((await api('put', `/api/coverage/${cov}`, { title: 't2' })).body).toMatchObject({ title: 't2', journalist_id: j });
    expect((await api('put', `/api/coverage/${cov}`, { journalistId: null, publishedAt: null })).body).toMatchObject({ title: 't2', journalist_id: null, published_at: null });
  });

  it('exports cannot run formulas in a spreadsheet', async () => {
    for (const name of ['=HYPERLINK("http://evil.example")', '+1', '-1', '@SUM(A1)']) await api('post', '/api/journalists', { name, bio: '' });
    const csv = (await api('get', '/api/export/journalists')).text;
    for (const cell of csv.split('\n').slice(1).map(l => l.split(',')[1])) expect(cell).toMatch(/^"?'/);
  });
});
