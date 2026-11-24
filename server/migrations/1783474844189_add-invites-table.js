/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE invites (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      token       TEXT NOT NULL UNIQUE,
      invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX invites_org_id_idx ON invites(org_id);
    CREATE INDEX invites_token_idx ON invites(token);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS invites;`);
};
