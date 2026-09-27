-- WHY: a pasted list asks GitHub to start the sync job now (when the Worker
-- has GITHUB_DISPATCH_TOKEN). Unthrottled, every /api/create for an unread
-- list was one GitHub API call on the owner's token, so a burst of visitors,
-- or anyone scripting the endpoint, became a burst of dispatches. One row holds
-- when the last dispatch went out; claimDispatchSlot (src/store.js) takes the
-- slot with a conditional UPDATE, so at most one dispatch leaves per interval.
-- Every dispatched run reads the whole queue, so nothing waits longer for it.
CREATE TABLE IF NOT EXISTS sync_dispatch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sync_dispatch (id, last_at) VALUES (1, '1970-01-01T00:00:00.000Z');
