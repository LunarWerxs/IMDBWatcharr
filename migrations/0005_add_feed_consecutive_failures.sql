-- WHY: markFeedFailure() recorded that a sync failed but never counted how
-- many happened IN A ROW, so a one-off IMDb hiccup and a feed that has gone
-- truly stale looked identical to the owner. consecutive_failures backs the
-- alert threshold in src/imdb.js (isFeedAlerting) and is reset to 0 by every
-- successful sync.
ALTER TABLE feeds ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
