import { describe, expect, it } from 'vitest';
import { hasDb, useTestApp } from '../setup/testDb';

describe.skipIf(!hasDb)('inTransaction', () => {
  const ctx = useTestApp();
  const fail = (code: string) => Object.assign(new Error(code), { code });

  it('retries a deadlock, gives up after three tries, and retries nothing else', async () => {
    const { inTransaction } = await import('../../src/db');
    let n = 0;
    expect(await inTransaction(async () => { if (++n < 3) throw fail('40P01'); return 'ok'; })).toBe('ok');
    expect(n).toBe(3);
    n = 0;
    await expect(inTransaction(async () => { n++; throw fail('40P01'); })).rejects.toThrow('40P01');
    expect(n).toBe(3);
    n = 0;
    await expect(inTransaction(async () => { n++; throw fail('23505'); })).rejects.toThrow('23505');
    expect(n).toBe(1);
  });

  it('rolls back on error and throws away a connection that broke', async () => {
    const { inTransaction } = await import('../../src/db');
    await expect(inTransaction(async db => {
      await db.query(`INSERT INTO rate_limits (bucket, window_start) VALUES ('rollback', NOW())`);
      await db.query('SELECT pg_terminate_backend(pg_backend_pid())');
    })).rejects.toThrow();
    for (let i = 0; i < 12; i++) expect((await ctx.pool.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    expect((await ctx.pool.query(`SELECT 1 FROM rate_limits WHERE bucket = 'rollback'`)).rowCount).toBe(0);
  });
});

describe('clip', () => {
  it('makes discovered text safe to store', async () => {
    const { clip, clipDate, clipUrl } = await import('../../src/lib/clip');
    expect(clip('a\u0000b\nc', 10)).toBe('a b c');
    expect(clip('xxxxx😀', 6)).toBe('xxxxx'); // no half characters
    expect([clip(null, 5), clip({}, 5), clip([], 5)]).toEqual(['', '', '']);
    expect([clipUrl('javascript:1'), clipUrl('https://e.example/x'), clipUrl(undefined)]).toEqual(['', 'https://e.example/x', '']);
    expect([clipDate('nope'), clipDate('99999-01-01'), clipDate(5)]).toEqual([null, null, null]);
    expect(clipDate('Tue, 04 Nov 2025 10:00:00 GMT')).toBe('2025-11-04T10:00:00.000Z');
  });
});
