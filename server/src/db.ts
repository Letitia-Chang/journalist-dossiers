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

/** Run `work` in a transaction; any error rolls it back and is rethrown. */
export async function inTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export default pool;
