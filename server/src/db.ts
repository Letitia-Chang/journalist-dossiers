import { Pool } from 'pg';

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

export default pool;
