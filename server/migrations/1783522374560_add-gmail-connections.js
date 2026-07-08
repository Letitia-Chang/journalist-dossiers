/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE gmail_connections (
      org_id        UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      email         TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      connected_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE campaign_journalists
      ADD COLUMN IF NOT EXISTS gmail_draft_id TEXT;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE campaign_journalists DROP COLUMN IF EXISTS gmail_draft_id;
    DROP TABLE IF EXISTS gmail_connections;
  `);
};
