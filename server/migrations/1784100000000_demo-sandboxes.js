/**
 * Demo visitors each get a private organization that expires. NULL means a real organization.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations ADD COLUMN demo_expires_at TIMESTAMPTZ;
    CREATE INDEX organizations_demo_expires_at_idx ON organizations(demo_expires_at) WHERE demo_expires_at IS NOT NULL;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  // Without the marker a sandbox would look like a real organization.
  pgm.sql(`
    DELETE FROM organizations WHERE demo_expires_at IS NOT NULL;
    ALTER TABLE organizations DROP COLUMN IF EXISTS demo_expires_at;
  `);
};
