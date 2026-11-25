/**
 * Publications saved with an RSS address but no feed row were never scanned. Give each one its row.
 * Addresses saved as a bare domain can't be fetched, so make them real URLs first.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  for (const column of ['url', 'rss_url']) {
    pgm.sql(`UPDATE publications SET ${column} = 'https://' || LTRIM(BTRIM(${column}), '/') WHERE ${column} ~ '\\S' AND BTRIM(${column}) !~* '^https?://'`);
  }
  pgm.sql(`
    UPDATE publication_feeds f SET feed_url = p.rss_url FROM publications p
    WHERE p.id = f.publication_id AND p.rss_url = 'https://' || LTRIM(BTRIM(f.feed_url), '/')
      AND NOT EXISTS (SELECT 1 FROM publication_feeds g WHERE g.publication_id = p.id AND g.feed_url = p.rss_url);
    INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
    SELECT p.org_id, p.id, p.rss_url, 'Main', 'main' FROM publications p
    WHERE p.rss_url <> '' AND NOT EXISTS (
      SELECT 1 FROM publication_feeds f WHERE f.publication_id = p.id AND f.feed_url = p.rss_url);
  `);
};

/** Nothing to undo: the rows are ordinary feeds and the addresses are the same ones. */
exports.down = () => {};
