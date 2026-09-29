-- Shared lists: one Radarr link and one Sonarr link fed by several IMDb lists,
-- which several signed-in people can add to. A household keeps one pair of
-- links in its Radarr and Sonarr while each person keeps their own watchlist.
--
-- `slug` is the public part of the two links; `invite_code` is the secret part
-- of the join link, kept apart so sharing the Radarr link never lets anyone in.
CREATE TABLE IF NOT EXISTS shared_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Everyone who may add lists, the owner included, with the name they signed in
-- under so the others can see who added what.
CREATE TABLE IF NOT EXISTS shared_list_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_list_id INTEGER NOT NULL,
  member_sub TEXT NOT NULL,
  member_name TEXT,
  joined_at TEXT NOT NULL,
  UNIQUE (shared_list_id, member_sub),
  FOREIGN KEY (shared_list_id) REFERENCES shared_lists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shared_list_members_sub
  ON shared_list_members (member_sub);

-- The IMDb lists feeding a shared list. A feed in any shared list is kept on
-- the sync schedule the way a claimed one is (readSyncTargets in src/store.js).
CREATE TABLE IF NOT EXISTS shared_list_sources (
  shared_list_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  added_by_sub TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (shared_list_id, feed_id),
  FOREIGN KEY (shared_list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shared_list_sources_feed
  ON shared_list_sources (feed_id);
