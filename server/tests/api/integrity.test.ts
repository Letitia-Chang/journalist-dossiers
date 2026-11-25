import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schemas from '../../src/lib/schemas';
import { startClaudeStub, type ClaudeStub } from '../setup/claudeStub';
import { hasDb, makeUser, useTestApp, type TestUser } from '../setup/testDb';

const gmail = vi.hoisted(() => ({ created: [] as string[], bodies: [] as string[], fail: false, expired: false, during: undefined as undefined | ((to: string) => Promise<void>) }));
vi.mock('../../src/services/gmailService', () => ({
  getAuthedGmailClient: async () => ({}),
  createGmailDraft: async (_g: unknown, to: string, _subject: string, body: string) => {
    await gmail.during?.(to);
    await new Promise(r => setTimeout(r, 30));
    if (gmail.expired) throw new Error('invalid_grant');
    if (gmail.fail) throw new Error('x');
    gmail.created.push(to);
    gmail.bodies.push(body);
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
    it('an AI score that finishes after the maximum was lowered respects the new maximum', async () => {
      stub.onCall = async () => { await ctx.pool.query('UPDATE scoring_dimensions SET weight = 2 WHERE id = $1', [d1]); };
      const res = await api('post', `/api/journalists/${j}/score`);
      stub.onCall = undefined;
      expect([res.status, res.body.total_score]).toEqual([200, 2 + 5]); // the stub scores everything 5
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
    it('a pitch someone writes themselves is ready, and editing it makes the Gmail copy out of date', async () => {
      const j2 = (await api('post', '/api/journalists', { name: 'J2', email: 'j2@example.com' })).body.id;
      await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: [j2] });
      const path = `/api/campaigns/${c}/journalists/${j2}/draft`;
      expect((await api('put', path, { draftSubject: 'Only a subject' })).body.status).toBe('not_started');
      expect((await api('put', path, { draftBody: 'And a body' })).body.status).toBe('ready');
      await ctx.pool.query(`UPDATE campaign_journalists SET gmail_draft_id = 'g1' WHERE journalist_id = $1`, [j2]);
      const gmailId = async () => (await api('get', `/api/campaigns/${c}/journalists`)).body.find((x: { journalist_id: number }) => x.journalist_id === j2).gmail_draft_id;
      await api('put', path, { draftBody: 'And a body' });
      expect(await gmailId()).toBe('g1'); // unchanged text
      await api('put', path, { draftBody: 'Different' });
      expect(await gmailId()).toBeNull();
    });
    it('clicking Generate twice writes, and pays for, each draft once', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push((await api('post', '/api/journalists', { name: `G${i}` })).body.id);
      await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: ids });
      stub.onCall = () => new Promise(r => setTimeout(r, 150));
      const both = await Promise.all([api('post', `/api/campaigns/${c}/generate-drafts`), api('post', `/api/campaigns/${c}/generate-drafts`)]);
      expect(both.map(r => r.body.generating).sort()).toEqual([0, 3]);
      expect((await api('post', `/api/campaigns/${c}/journalists/${ids[2]}/regenerate`, {})).status).toBe(409);
      await vi.waitFor(async () => expect((await api('get', `/api/campaigns/${c}/journalists`)).body.filter((x: { status: string }) => x.status === 'drafting')).toHaveLength(0), { timeout: 8000 });
      stub.onCall = undefined;
      expect(stub.calls).toHaveLength(3);
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.generating).toBe(0);
    });
    it('a draft someone writes while one is being generated is kept', async () => {
      const j2 = (await api('post', '/api/journalists', { name: 'W' })).body.id;
      await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: [j2] });
      stub.onCall = async () => { await api('put', `/api/campaigns/${c}/journalists/${j2}/draft`, { draftSubject: 'Mine', draftBody: 'Mine too' }); };
      await api('post', `/api/campaigns/${c}/generate-drafts`);
      await vi.waitFor(() => expect(stub.calls.length).toBe(1));
      await new Promise(r => setTimeout(r, 400));
      stub.onCall = undefined;
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body.find((x: { journalist_id: number }) => x.journalist_id === j2)).toMatchObject({ draft_subject: 'Mine', status: 'ready' });
    });
    it('an interrupted generation can be retried', async () => {
      const j2 = (await api('post', '/api/journalists', { name: 'S' })).body.id;
      await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: [j2] });
      const set = (age: string) => ctx.pool.query(`UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW() - $2::interval WHERE journalist_id = $1`, [j2, age]);
      await set('1 minute');
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.generating).toBe(0);
      await set('11 minutes');
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.generating).toBe(1);
      await vi.waitFor(() => expect(stub.calls.length).toBe(1));
    });

    /** A journalist added to the campaign, with helpers for that row. */
    const member = async (name: string, draft?: { draftSubject: string; draftBody: string }) => {
      const id: number = (await api('post', '/api/journalists', { name, email: `${name}@example.com` })).body.id;
      await api('post', `/api/campaigns/${c}/journalists`, { journalistIds: [id] });
      const path = `/api/campaigns/${c}/journalists/${id}`;
      if (draft) await api('put', `${path}/draft`, draft);
      const row = async () => (await api('get', `/api/campaigns/${c}/journalists`)).body.find((x: { journalist_id: number }) => x.journalist_id === id);
      return { id, path, row };
    };
    const slow = () => { stub.onCall = () => new Promise(r => setTimeout(r, 200)); };
    const idle = () => vi.waitFor(async () => expect((await api('get', `/api/campaigns/${c}/journalists`)).body.filter((x: { status: string }) => x.status === 'drafting')).toHaveLength(0), { timeout: 8000 });

    it('an interrupted draft shows as it was, so it can be written or generated again', async () => {
      const blank = await member('blank');
      const kept = await member('kept', { draftSubject: 'S', draftBody: 'B' });
      await ctx.pool.query(`UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW() - INTERVAL '11 minutes' WHERE journalist_id = ANY($1::int[])`, [[blank.id, kept.id]]);
      expect([(await blank.row()).status, (await kept.row()).status]).toEqual(['not_started', 'ready']);
      expect((await api('post', `${kept.path}/regenerate`, {})).body).toMatchObject({ status: 'ready', draft_subject: expect.not.stringMatching(/^S$/) });
    });
    it('regenerating pays once, however it is clicked', async () => {
      const m = await member('twice');
      slow();
      const all = await Promise.all([api('post', `${m.path}/regenerate`, {}), api('post', `${m.path}/regenerate`, {}), api('post', `/api/campaigns/${c}/generate-drafts`)]);
      await idle();
      stub.onCall = undefined;
      expect(stub.calls).toHaveLength(1);
      expect(all.slice(0, 2).map(r => r.status).filter(x => x === 200).length).toBeLessThanOrEqual(1);
      expect((await m.row()).status).toBe('ready');
    });
    it('a pitch saved while the AI rewrites it is kept', async () => {
      const m = await member('saved', { draftSubject: 'Old', draftBody: 'Old' });
      stub.onCall = async () => { await api('put', `${m.path}/draft`, { draftBody: 'Mine' }); };
      expect((await api('post', `${m.path}/regenerate`, {})).status).toBe(409);
      stub.onCall = undefined;
      expect(await m.row()).toMatchObject({ draft_subject: 'Old', draft_body: 'Mine', status: 'ready' });
    });
    it('a failed rewrite keeps the old pitch', async () => {
      const m = await member('fails', { draftSubject: 'Old', draftBody: 'Old' });
      stub.fail = true;
      expect((await api('post', `${m.path}/regenerate`, {})).status).toBe(502);
      stub.fail = false;
      expect(await m.row()).toMatchObject({ draft_body: 'Old', status: 'ready' });
    });
    it('a long batch is not paid for twice', async () => {
      await member('l1'); await member('l2'); await member('l3');
      let first = true;
      stub.onCall = async () => {
        if (!first) return;
        first = false;
        // The first call took so long that the waiting rows look interrupted, and someone clicks again.
        await ctx.pool.query(`UPDATE campaign_journalists SET updated_at = NOW() - INTERVAL '11 minutes' WHERE campaign_id = $1 AND status = 'drafting' AND id > (SELECT MIN(id) FROM campaign_journalists WHERE campaign_id = $1 AND status = 'drafting')`, [c]);
        expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.generating).toBe(2);
      };
      await api('post', `/api/campaigns/${c}/generate-drafts`);
      await idle();
      stub.onCall = undefined;
      expect(stub.calls).toHaveLength(3);
    });
    it('a journalist removed mid-batch is not paid for', async () => {
      await member('r1');
      const gone = await member('r2');
      stub.onCall = async () => { await api('delete', gone.path); };
      await api('post', `/api/campaigns/${c}/generate-drafts`);
      await idle();
      stub.onCall = undefined;
      expect(stub.calls).toHaveLength(1);
    });
    it('what Gmail gets is what the pitch says', async () => {
      const m = await member('gm', { draftSubject: 'S', draftBody: 'First' });
      await member('nobody', { draftSubject: 'Subject only', draftBody: ' ' });
      gmail.bodies.length = 0;
      const during: number[] = [];
      gmail.during = async to => {
        if (to !== 'gm@example.com') return;
        during.push((await api('put', `${m.path}/draft`, { draftBody: 'Changed' })).status, (await api('post', `${m.path}/regenerate`, {})).status);
      };
      await api('post', `/api/campaigns/${c}/create-gmail-drafts`);
      gmail.during = undefined;
      expect(during).toEqual([409, 409]);
      expect(stub.calls).toHaveLength(0);
      expect(gmail.bodies).toContain('First');
      expect(gmail.bodies.filter(b => !b.trim())).toEqual([]); // a pitch with no body is not ready for Gmail
      expect(await m.row()).toMatchObject({ draft_body: 'First', gmail_draft_id: expect.stringMatching(/^draft-/) });
      expect((await api('put', `${m.path}/draft`, { draftBody: 'Changed' })).status).toBe(200);
      expect((await m.row()).gmail_draft_id).toBeNull();
    });
    it('making a Gmail draft from an interrupted rewrite leaves it ready', async () => {
      const m = await member('revived', { draftSubject: 'S', draftBody: 'B' });
      await ctx.pool.query(`UPDATE campaign_journalists SET status = 'drafting', updated_at = NOW() - INTERVAL '11 minutes' WHERE journalist_id = $1`, [m.id]);
      await api('post', `/api/campaigns/${c}/create-gmail-drafts`);
      expect(await m.row()).toMatchObject({ status: 'ready', gmail_draft_id: expect.stringMatching(/^draft-/) });
    });
    it('a pitch cleared again can be generated', async () => {
      const m = await member('cleared', { draftSubject: 'S', draftBody: 'B' });
      expect((await api('put', `${m.path}/draft`, { draftSubject: ' ', draftBody: '' })).body.status).toBe('not_started');
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.generating).toBe(1);
      await idle();
    });
    it('cannot be removed and re-added to send it twice', async () => {
      await api('post', `${p()}/send`);
      expect((await api('delete', p())).status).toBe(409);
      expect((await api('get', `/api/campaigns/${c}/journalists`)).body).toHaveLength(1);
    });
    it('generating drafts skips a sent pitch that has no text', async () => {
      await ctx.pool.query(`UPDATE campaign_journalists SET draft_subject = '', draft_body = '', status = 'sent' WHERE campaign_id = $1`, [c]);
      expect((await api('post', `/api/campaigns/${c}/generate-drafts`)).body.message).toMatch(/nothing to generate/);
    });
    it('a draft finished after the pitch was marked sent does not overwrite it', async () => {
      await ctx.pool.query(`UPDATE campaign_journalists SET draft_subject = '', draft_body = '', status = 'not_started' WHERE campaign_id = $1`, [c]);
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
      expect((await go()).body).toMatchObject({ created: 0, failed: 1 });
      gmail.fail = false;
      gmail.expired = true;
      const dead = await go();
      expect([dead.status, dead.body.error]).toEqual([400, expect.stringMatching(/expired/)]);
      gmail.expired = false;
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
    expect(schemas.articleCreate.parse({ journalistId: 1, title: 'a', publishedAt: '2026-01-02' }).publishedAt).toBe('2026-01-02T00:00:00Z'); // whatever time zone the database is in
    expect((await api('put', `/api/articles/${art}`, { title: 'b' })).body.published_at).toBe('2026-01-02T00:00:00.000Z');
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

  it('caps what a feed scan stores', async () => {
    const http = await import('http');
    const feed = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>f</title><item><title>${'z'.repeat(60_000)}</title><link>javascript:alert(1)</link><dc:creator>Jane Roe</dc:creator><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    const server = http.createServer((_req, res) => { res.setHeader('content-type', 'application/rss+xml'); res.end(feed); });
    await new Promise<void>(r => { server.listen(0, () => r()); });
    const port = (server.address() as import('net').AddressInfo).port;
    const pub = (await api('post', '/api/publications', { name: 'Feed', url: 'https://f.example', rssUrl: `http://127.0.0.1:${port}/rss` })).body.id;
    const { scanPublicationRss } = await import('../../src/services/rssService');
    await scanPublicationRss(o.orgId, pub);
    server.closeAllConnections(); server.close();
    const [s] = (await api('get', '/api/journalist-suggestions')).body;
    expect([s.name, s.recent_article_title.length, s.recent_article_url]).toEqual(['Jane Roe', 300, '']);
    expect(s.all_articles.length).toBeLessThan(2000);
  });

  describe('feeds', () => {
    const feeds = async (pub: number) => (await api('get', `/api/publications/${pub}/feeds`)).body.map((f: { feed_url: string }) => f.feed_url).sort();
    it('an RSS address always has a feed to scan, however it was added or changed', async () => {
      const pub = (await api('post', '/api/publications', { name: 'P', url: 'p.example', rssUrl: 'p.example/rss' })).body;
      expect(pub).toMatchObject({ url: 'https://p.example', rss_url: 'https://p.example/rss' }); // bare domains become real links
      expect(await feeds(pub.id)).toEqual(['https://p.example/rss']);
      await api('post', `/api/publications/${pub.id}/feeds`, { feedUrl: 'https://p.example/extra' });
      await api('put', `/api/publications/${pub.id}`, { rssUrl: 'https://p.example/new' });
      expect(await feeds(pub.id)).toEqual(['https://p.example/extra', 'https://p.example/new']);
      await api('put', `/api/publications/${pub.id}`, { focus: 'x' });
      expect(await feeds(pub.id)).toHaveLength(2); // not mentioned, not touched
      const main = (await api('get', `/api/publications/${pub.id}/feeds`)).body.find((x: { feed_url: string }) => x.feed_url === 'https://p.example/new');
      expect((await api('delete', `/api/publications/${pub.id}/feeds/${main.id}`)).status).toBe(204);
      expect((await api('get', `/api/publications/${pub.id}`)).body.rss_url).toBe(''); // a deleted main feed stays deleted
      const opml = '<opml><body><outline title="One" xmlUrl="https://one.example/rss" htmlUrl="https://one.example"/></body></opml>';
      expect((await api('post', '/api/publications/import-opml', { opml })).body).toEqual({ added: 1, feedsAdded: 1, skipped: 0 });
      const one = (await api('get', '/api/publications')).body.find((x: { name: string }) => x.name === 'One').id;
      expect(await feeds(one)).toEqual(['https://one.example/rss']);
      expect((await api('post', '/api/publications/import-opml', { opml })).body).toEqual({ added: 0, feedsAdded: 0, skipped: 1 });
    });
  });

  it('keeps old free-form contact details editable, but never multi-line', async () => {
    const id = (await api('post', '/api/journalists', { name: 'x', email: 'a@x.com; b@x.com' })).body.id;
    expect((await api('put', `/api/journalists/${id}`, { email: 'a@x.com; b@x.com', bio: 'new' })).status).toBe(200);
    expect((await api('put', `/api/journalists/${id}`, { email: 'a@x.com\r\nBcc: z@x.com' })).status).toBe(400);
  });

  it('exports cannot run formulas in a spreadsheet', async () => {
    for (const name of ['=HYPERLINK("http://evil.example")', '+1', '-1', '@SUM(A1)', ' =1+1']) await api('post', '/api/journalists', { name, bio: '' });
    const csv = (await api('get', '/api/export/journalists')).text;
    const target = (await api('get', '/api/journalists')).body[0].id;
    for (const notes of [' =1+1', '\n=1+1', '\t@x']) await api('post', '/api/outreach', { journalistId: target, type: 'note', status: 'x', notes });
    expect((await api('get', '/api/export/outreach')).text.match(/,"?'\s*[=@]/g)).toHaveLength(3);
    for (const cell of csv.split('\n').slice(1).map(l => l.split(',')[1])) expect(cell).toMatch(/^"?'/);
  });
});
