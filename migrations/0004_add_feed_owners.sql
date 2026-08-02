-- Feed ownership, which is the whole point of signing in: an owned feed is
-- re-synced on the schedule, an unowned one is fetched on demand only.
--
-- A join table rather than a column on feeds, because two people can point at
-- the same public IMDb list and neither should be able to take it from the
-- other. A feed syncs while at least one person still wants it.
CREATE TABLE IF NOT EXISTS feed_owners (
  feed_id INTEGER NOT NULL,
  owner_sub TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (feed_id, owner_sub),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_owners_sub
  ON feed_owners (owner_sub);
