/**
 * Single-company mode: the company profile becomes the source of truth for every
 * AI prompt. The two free-text columns that used to live on `organizations` are
 * folded into it, and per-dimension scores gain a rationale + evidence URLs.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE company_profile (
      org_id           UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      website          TEXT NOT NULL DEFAULT '',
      one_liner        TEXT NOT NULL DEFAULT '',
      industry         TEXT NOT NULL DEFAULT '',
      products         TEXT NOT NULL DEFAULT '',
      target_audience  TEXT NOT NULL DEFAULT '',
      regions          JSONB NOT NULL DEFAULT '[]',
      key_messages     JSONB NOT NULL DEFAULT '[]',
      newsworthy_items JSONB NOT NULL DEFAULT '[]',
      competitors      JSONB NOT NULL DEFAULT '[]',
      press_coverage   JSONB NOT NULL DEFAULT '[]',
      spokespeople     JSONB NOT NULL DEFAULT '[]',
      pitch_tone       TEXT NOT NULL DEFAULT '',
      email_signature  TEXT NOT NULL DEFAULT '',
      app_name         TEXT NOT NULL DEFAULT 'Press Dossier',
      logo_url         TEXT NOT NULL DEFAULT '',
      brand_color      TEXT NOT NULL DEFAULT '#4f46e5',
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO company_profile (org_id, name, one_liner, industry)
    SELECT id, name, COALESCE(company_description, ''), COALESCE(array_to_string(target_verticals, ', '), '')
    FROM organizations;

    ALTER TABLE organizations
      DROP COLUMN IF EXISTS company_description,
      DROP COLUMN IF EXISTS target_verticals;

    ALTER TABLE journalist_scores
      ADD COLUMN IF NOT EXISTS rationale TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS evidence  JSONB NOT NULL DEFAULT '[]';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE journalist_scores DROP COLUMN IF EXISTS rationale, DROP COLUMN IF EXISTS evidence;
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS company_description TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS target_verticals TEXT[] DEFAULT '{}';
    UPDATE organizations o SET company_description = p.one_liner FROM company_profile p WHERE p.org_id = o.id;
    DROP TABLE IF EXISTS company_profile;
  `);
};
