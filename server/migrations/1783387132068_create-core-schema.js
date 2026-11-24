/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- ── Identity ────────────────────────────────────────────────────────────

    CREATE TABLE organizations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                TEXT NOT NULL,
      slug                TEXT NOT NULL UNIQUE,
      company_description TEXT DEFAULT '',
      target_verticals    TEXT[] DEFAULT '{}',
      tier_thresholds     JSONB NOT NULL DEFAULT '{"tier1":80,"tier2":60,"tier3":40}',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX users_org_id_idx ON users(org_id);

    -- ── Configurable scoring ────────────────────────────────────────────────

    CREATE TABLE scoring_dimensions (
      id             SERIAL PRIMARY KEY,
      org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      weight         INTEGER NOT NULL DEFAULT 0,
      display_order  INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX scoring_dimensions_org_id_idx ON scoring_dimensions(org_id);

    -- ── Publications ────────────────────────────────────────────────────────

    CREATE TABLE publications (
      id               SERIAL PRIMARY KEY,
      org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      url              TEXT DEFAULT '',
      tier             TEXT DEFAULT 'B',
      focus            TEXT DEFAULT '',
      notes            TEXT DEFAULT '',
      active           BOOLEAN NOT NULL DEFAULT TRUE,
      rss_url          TEXT DEFAULT '',
      rss_status       TEXT DEFAULT 'unknown',
      rss_status_note  TEXT DEFAULT '',
      rss_last_checked TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX publications_org_id_idx ON publications(org_id);

    CREATE TABLE publication_feeds (
      id             SERIAL PRIMARY KEY,
      org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      feed_url       TEXT NOT NULL,
      feed_label     TEXT DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX publication_feeds_org_id_idx ON publication_feeds(org_id);
    CREATE INDEX publication_feeds_publication_id_idx ON publication_feeds(publication_id);

    CREATE TABLE publication_suggestions (
      id          SERIAL PRIMARY KEY,
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      url         TEXT DEFAULT '',
      focus       TEXT DEFAULT '',
      rationale   TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX publication_suggestions_org_id_idx ON publication_suggestions(org_id);

    -- ── Journalists ─────────────────────────────────────────────────────────

    CREATE TABLE journalists (
      id             SERIAL PRIMARY KEY,
      org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      publication_id INTEGER REFERENCES publications(id) ON DELETE SET NULL,
      name           TEXT NOT NULL,
      email          TEXT DEFAULT '',
      twitter        TEXT DEFAULT '',
      linkedin       TEXT DEFAULT '',
      bio            TEXT DEFAULT '',
      beats          TEXT[] DEFAULT '{}',
      total_score    INTEGER NOT NULL DEFAULT 0,
      is_favorite    BOOLEAN NOT NULL DEFAULT FALSE,
      photo_url      TEXT DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX journalists_org_id_idx ON journalists(org_id);
    CREATE INDEX journalists_publication_id_idx ON journalists(publication_id);

    CREATE TABLE journalist_scores (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      journalist_id INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
      dimension_id  INTEGER NOT NULL REFERENCES scoring_dimensions(id) ON DELETE CASCADE,
      score         INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (journalist_id, dimension_id)
    );
    CREATE INDEX journalist_scores_org_id_idx ON journalist_scores(org_id);

    CREATE TABLE journalist_suggestions (
      id             SERIAL PRIMARY KEY,
      org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      publication_id INTEGER REFERENCES publications(id) ON DELETE SET NULL,
      name           TEXT NOT NULL,
      email          TEXT DEFAULT '',
      source_url     TEXT DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX journalist_suggestions_org_id_idx ON journalist_suggestions(org_id);

    CREATE TABLE articles (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      journalist_id INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      url           TEXT DEFAULT '',
      summary       TEXT DEFAULT '',
      published_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX articles_org_id_idx ON articles(org_id);
    CREATE INDEX articles_journalist_id_idx ON articles(journalist_id);

    -- ── Campaigns & outreach ────────────────────────────────────────────────

    CREATE TABLE campaign_type_styles (
      id           SERIAL PRIMARY KEY,
      org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_type TEXT NOT NULL,
      instructions TEXT DEFAULT '',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, campaign_type)
    );

    CREATE TABLE campaigns (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      brief         TEXT NOT NULL DEFAULT '',
      campaign_type TEXT DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'draft',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX campaigns_org_id_idx ON campaigns(org_id);

    CREATE TABLE campaign_journalists (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      journalist_id INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
      draft_subject TEXT DEFAULT '',
      draft_body    TEXT DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'not_started',
      sent_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (campaign_id, journalist_id)
    );
    CREATE INDEX campaign_journalists_org_id_idx ON campaign_journalists(org_id);
    CREATE INDEX campaign_journalists_campaign_id_idx ON campaign_journalists(campaign_id);

    CREATE TABLE outreach_logs (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      journalist_id INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
      campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      logged_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pitched',
      notes         TEXT DEFAULT '',
      logged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX outreach_logs_org_id_idx ON outreach_logs(org_id);
    CREATE INDEX outreach_logs_org_id_logged_at_idx ON outreach_logs(org_id, logged_at);
    CREATE INDEX outreach_logs_journalist_id_idx ON outreach_logs(journalist_id);

    CREATE TABLE coverage (
      id            SERIAL PRIMARY KEY,
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      journalist_id INTEGER REFERENCES journalists(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      url           TEXT DEFAULT '',
      notes         TEXT DEFAULT '',
      published_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX coverage_org_id_idx ON coverage(org_id);
    CREATE INDEX coverage_org_id_published_at_idx ON coverage(org_id, published_at);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS coverage;
    DROP TABLE IF EXISTS outreach_logs;
    DROP TABLE IF EXISTS campaign_journalists;
    DROP TABLE IF EXISTS campaigns;
    DROP TABLE IF EXISTS campaign_type_styles;
    DROP TABLE IF EXISTS articles;
    DROP TABLE IF EXISTS journalist_suggestions;
    DROP TABLE IF EXISTS journalist_scores;
    DROP TABLE IF EXISTS journalists;
    DROP TABLE IF EXISTS publication_suggestions;
    DROP TABLE IF EXISTS publication_feeds;
    DROP TABLE IF EXISTS publications;
    DROP TABLE IF EXISTS scoring_dimensions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS organizations;
  `);
};
