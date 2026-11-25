/**
 * Fixed-window counters shared by every instance and kept across restarts. Buckets hold a keyed
 * hash of the client address, never the address itself.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE rate_limits (
      bucket       TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      count        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    );
    CREATE INDEX rate_limits_window_start_idx ON rate_limits(window_start);
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS rate_limits;'); };
