import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startClaudeStub, type ClaudeStub } from '../setup/claudeStub';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

const gmail = vi.hoisted(() => ({ created: [] as string[], fail: false }));
vi.mock('../../src/services/gmailService', () => ({
  getAuthedGmailClient: async () => ({}),
  createGmailDraft: async (_g: unknown, to: string) => {
    await new Promise(r => setTimeout(r, 30));
    if (gmail.fail) throw new Error('x');
    gmail.created.push(to);
    return `draft-${gmail.created.length}`;
  },
}));

describe.skipIf(!hasDb)('data integrity', () => {
  const ctx = useTestApp();
  let o: TestUser;
  const api = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: object) => { const r = request(ctx.app)[m](p).set(o.auth); return b ? r.send(b) : r; };
  let stub: ClaudeStub;
  beforeAll(async () => { stub = await startClaudeStub(); });
  afterAll(() => { stub.close(); });
  beforeEach(async () => { o = await makeUser(ctx); stub.calls.length = 0; });

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
    it('stays consistent, without deadlocks, under concurrent edits', async () => {
      const j2 = (await api('post', '/api/journalists', { name: 'J2', scores: [{ dimensionId: d1, score: 1 }] })).body.id;
      for (let i = 0; i < 15; i++) {
        const res = await Promise.all([
          api('put', `/api/scoring-dimensions/${d1}`, { weight: 10 + (i % 5) }), api('put', `/api/scoring-dimensions/${d2}`, { weight: 5 + (i % 5) }),
          ...[j, j2].flatMap(id => [1, 2].map(n => api('put', `/api/journalists/${id}`, { scores: [{ dimensionId: n === 1 ? d1 : d2, score: n }, { dimensionId: n === 1 ? d2 : d1, score: n }] }))),
        ]);
        expect(res.map(r => r.status).filter(c => c >= 500)).toEqual([]);
      }
      const { rows } = await ctx.pool.query(`SELECT j.total_score, SUM(s.score)::int AS sum, MAX(s.score - d.weight) AS over FROM journalists j JOIN journalist_scores s ON s.journalist_id = j.id JOIN scoring_dimensions d ON d.id = s.dimension_id WHERE j.org_id = $1 GROUP BY j.id`, [o.orgId]);
      for (const r of rows) { expect(r.total_score).toBe(r.sum); expect(r.over).toBeLessThanOrEqual(0); }
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
    it('cannot be removed and re-added to send it twice', async () => {
      await api('post', `${p()}/send`);
      expect((await api('delete', p())).status).toBe(409);
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body).toHaveLength(1);
    });
    it('generating drafts skips a sent pitch that has no text', async () => {
      await ctx.pool.query(`UPDATE campaign_journalists SET draft_subject = '', draft_body = '', status = 'sent' WHERE campaign_id = $1`, [c]);
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.message).toMatch(/for 0 journalists/);
    });
    it('a draft finished after the pitch was marked sent does not overwrite it', async () => {
      await ctx.pool.query(`UPDATE campaign_journalists SET draft_subject = '' WHERE campaign_id = $1`, [c]);
      stub.onCall = async () => { await ctx.pool.query(`UPDATE campaign_journalists SET status = 'sent', draft_subject = 'Sent by hand' WHERE campaign_id = $1`, [c]); };
      await api('post', `/api/campaigns/${c}/generate-drafts`);
      await vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0));
      await new Promise(r => setTimeout(r, 300));
      stub.onCall = undefined;
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body[0]).toMatchObject({ status: 'sent', draft_subject: 'Sent by hand' });
    });
    it('makes one Gmail draft per unsent pitch, even on a double click, and retries after a failure', async () => {
      gmail.created.length = 0;
      const go = () => api('post', `/api/campaigns/${c}/create-gmail-drafts`);
      gmail.fail = true;
      expect((await go()).body.created).toBe(0);
      gmail.fail = false;
      // Hold the row so all three requests have read it as unclaimed before any can claim it.
      const lock = await ctx.pool.connect();
      await lock.query('BEGIN');
      await lock.query('SELECT 1 FROM campaign_journalists WHERE campaign_id = $1 FOR UPDATE', [c]);
      const all = Promise.all([go(), go(), go()].map(r => r.then(x => x)));
      await new Promise(r => setTimeout(r, 500));
      await lock.query('COMMIT');
      lock.release();
      await all;
      expect(gmail.created).toEqual(['j@example.com']);
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body[0].gmail_draft_id).toBe('draft-1');
      await ctx.pool.query(`UPDATE campaign_journalists SET gmail_draft_id = NULL, status = 'sent' WHERE campaign_id = $1`, [c]);
      expect((await go()).body).toMatchObject({ created: 0, total: 0 });
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
    const art = (await api('post', '/api/articles', { journalistId: j, title: 'a', publishedAt: '2026-01-02' })).body.id;
    expect((await api('put', `/api/articles/${art}`, { title: 'b' })).body.published_at).not.toBeNull();
    expect((await api('put', `/api/articles/${art}`, { publishedAt: '' })).body).toMatchObject({ title: 'b', published_at: null });
    const cov = (await api('post', '/api/coverage', { title: 't', journalistId: j, publishedAt: '2026-01-02' })).body.id;
    expect((await api('put', `/api/coverage/${cov}`, { title: 't2' })).body).toMatchObject({ title: 't2', journalist_id: j });
    expect((await api('put', `/api/coverage/${cov}`, { journalistId: null, publishedAt: null })).body).toMatchObject({ title: 't2', journalist_id: null, published_at: null });
  });

  it('caps and cleans what discovery found before it becomes a journalist', async () => {
    const pub = (await api('post', '/api/publications', { name: 'P' })).body.id;
    const all = [{ title: 'x'.repeat(60_000), url: 'javascript:alert(1)', date: 'not a date' }, { title: 'Second', url: 'https://e.example/2', date: 'Tue, 04 Nov 2025 10:00:00 GMT' }];
    const { rows: [s] } = await ctx.pool.query(
      `INSERT INTO journalist_suggestions (org_id, publication_id, name, recent_article_title, recent_article_url, all_articles) VALUES ($1, $2, 'Found Person', $3, 'https://e.example/1', $4) RETURNING id`,
      [o.orgId, pub, 'y'.repeat(60_000), JSON.stringify(all)]);
    const id = (await api('post', `/api/journalist-suggestions/${s.id}/accept`)).body.journalistId;
    const j = (await api('get', `/api/journalists/${id}`)).body;
    expect(j.bio.length).toBeLessThanOrEqual(4000);
    const arts = (await api('get', `/api/articles/journalist/${id}`)).body;
    expect(arts.map((a: { title: string; url: string }) => [a.title.length, a.url])).toEqual([[6, 'https://e.example/2'], [300, '']]);
    expect((await api('put', `/api/journalists/${id}`, { name: j.name, bio: j.bio, beats: j.beats })).status).toBe(200); // still editable
  });

  it('exports cannot run formulas in a spreadsheet', async () => {
    for (const name of ['=HYPERLINK("http://evil.example")', '+1', '-1', '@SUM(A1)', ' =1+1']) await api('post', '/api/journalists', { name, bio: '' });
    const csv = (await api('get', '/api/export/journalists')).text;
    for (const cell of csv.split('\n').slice(1).map(l => l.split(',')[1])) expect(cell).toMatch(/^"?'/);
  });
});
