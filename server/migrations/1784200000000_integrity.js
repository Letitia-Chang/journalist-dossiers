/**
 * Bring existing rows in line with rules the app now enforces.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Lowering a dimension's weight used to leave scores above it.
    UPDATE journalist_scores s SET score = d.weight FROM scoring_dimensions d
      WHERE d.id = s.dimension_id AND s.score > d.weight;
    UPDATE journalists j SET total_score = COALESCE(
      (SELECT SUM(s.score) FROM journalist_scores s WHERE s.journalist_id = j.id AND s.org_id = j.org_id), 0)::int;

    -- Emails are matched without regard to case. Normalize them, except where two accounts differ
    -- only by case: those are left alone for a person to resolve.
    UPDATE users u SET email = LOWER(TRIM(u.email))
      WHERE u.email <> LOWER(TRIM(u.email))
        AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id <> u.id AND LOWER(TRIM(o.email)) = LOWER(TRIM(u.email)));
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1) THEN
        CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email));
      ELSE
        RAISE NOTICE 'Two accounts differ only by email case; skipping the unique index.';
      END IF;
    END $$;

    -- At most one open invite per email: keep the newest.
    UPDATE invites i SET status = 'revoked' WHERE status = 'pending' AND EXISTS (
      SELECT 1 FROM invites n WHERE n.org_id = i.org_id AND n.email = i.email AND n.status = 'pending'
        AND (n.created_at, n.id) > (i.created_at, i.id));
    CREATE UNIQUE INDEX invites_one_pending_key ON invites (org_id, email) WHERE status = 'pending';
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS invites_one_pending_key;
    DROP INDEX IF EXISTS users_email_lower_key;
  `);
};
