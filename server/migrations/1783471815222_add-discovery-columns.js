/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE publications
      ADD COLUMN IF NOT EXISTS health_status     TEXT DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS last_health_check  TIMESTAMPTZ;

    ALTER TABLE publication_feeds
      ADD COLUMN IF NOT EXISTS feed_type        TEXT DEFAULT 'main',
      ADD COLUMN IF NOT EXISTS rss_status       TEXT DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS rss_last_checked TIMESTAMPTZ;

    ALTER TABLE journalist_suggestions
      ADD COLUMN IF NOT EXISTS source_type          TEXT DEFAULT 'rss',
      ADD COLUMN IF NOT EXISTS recent_article_title  TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS recent_article_url    TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS recent_article_date   TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS suggested_beat        TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS relevance_score       INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS matched_tags          TEXT DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS article_count         INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS all_articles           TEXT DEFAULT '[]';

    ALTER TABLE publication_suggestions
      ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'B';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE publications DROP COLUMN IF EXISTS health_status, DROP COLUMN IF EXISTS last_health_check;
    ALTER TABLE publication_feeds DROP COLUMN IF EXISTS feed_type, DROP COLUMN IF EXISTS rss_status, DROP COLUMN IF EXISTS rss_last_checked;
    ALTER TABLE journalist_suggestions
      DROP COLUMN IF EXISTS source_type,
      DROP COLUMN IF EXISTS recent_article_title,
      DROP COLUMN IF EXISTS recent_article_url,
      DROP COLUMN IF EXISTS recent_article_date,
      DROP COLUMN IF EXISTS suggested_beat,
      DROP COLUMN IF EXISTS relevance_score,
      DROP COLUMN IF EXISTS matched_tags,
      DROP COLUMN IF EXISTS article_count,
      DROP COLUMN IF EXISTS all_articles;
    ALTER TABLE publication_suggestions DROP COLUMN IF EXISTS tier;
  `);
};
