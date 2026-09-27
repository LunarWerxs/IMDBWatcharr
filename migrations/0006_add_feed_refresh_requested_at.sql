-- WHY: the sync job only ever read feeds somebody had claimed by signing in,
-- and the "read it now" dispatch needs a GitHub token the Worker was never
-- given. So a list pasted by a signed-out visitor was never read at all: 56 of
-- the first 73 feeds sat at 'pending' forever and both of their URLs answered
-- 503. refresh_requested_at is the queue that fixes it: set when a feed is
-- created or someone asks for a fresh read, read by /api/sync-targets, cleared
-- by the next successful read (or given up after repeated failures).
ALTER TABLE feeds ADD COLUMN refresh_requested_at TEXT;

-- Every feed that was never read gets its first read queued now, in the order
-- people asked for them.
UPDATE feeds
   SET refresh_requested_at = created_at
 WHERE last_synced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feeds_refresh_requested_at
  ON feeds (refresh_requested_at)
  WHERE refresh_requested_at IS NOT NULL;
