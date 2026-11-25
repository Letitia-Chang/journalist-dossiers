/**
 * Publications saved with an RSS address but no feed row were never scanned. Give each one its row.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO publication_feeds (org_id, publication_id, feed_url, feed_label, feed_type)
    SELECT p.org_id, p.id, p.rss_url, 'Main', 'main' FROM publications p
    WHERE p.rss_url <> '' AND NOT EXISTS (
      SELECT 1 FROM publication_feeds f WHERE f.publication_id = p.id AND f.feed_url = p.rss_url);
  `);
};

/** Nothing to undo: the rows are ordinary feeds. */
exports.down = () => {};
