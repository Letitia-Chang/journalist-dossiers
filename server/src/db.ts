import { Pool, type PoolClient } from 'pg';

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// An idle client losing its connection (Neon suspends idle databases) is emitted here; with no
// listener Node would treat it as an uncaught exception and exit. The pool replaces the client.
pool.on('error', err => console.error('[db] idle client error:', err.message));
// The pool stops listening while a client is checked out, so a connection that drops in the middle of
// a transaction needs its own listener. The running query still rejects and is handled normally.
pool.on('connect', client => { client.on('error', err => console.error('[db] client error:', err.message)); });

/**
 * Run `work` in a transaction; any error rolls it back and is rethrown. A deadlock is retried, so
 * `work` must only touch the database through `db` (which also avoids holding two connections).
 */
export async function inTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const db = await pool.connect();
    let broken: Error | undefined;
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (err) {
      await db.query('ROLLBACK').catch((e: Error) => { broken = e; });
      if ((err as { code?: string }).code !== '40P01' || attempt >= 3) throw err;
    } finally {
      db.release(broken); // a connection that can't roll back is discarded, not reused
    }
  }
}

export default pool;
