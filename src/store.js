// Every D1 statement the Worker runs, in one place, so the route handlers read
// as HTTP and the SQL reads as SQL.

import { createStableSlug } from "./imdb.js";

// A claimed feed older than this is re-fetched when Radarr or Sonarr polls it.
const STALE_AFTER_MS = 1000 * 60 * 60 * 6;

// How many signed-out feeds one sync run may pick up. Anyone can queue a list,
// so the queue is bounded per run rather than trusted to stay small; the rest
// wait for the next run, oldest request first.
export const REQUESTED_FEEDS_PER_RUN = 50;

export function nowIso() {
  return new Date().toISOString();
}

export function isStale(feed) {
  if (!feed?.last_synced_at) {
    return true;
  }

  return Date.now() - Date.parse(feed.last_synced_at) > STALE_AFTER_MS;
}

export async function getFeedBySlug(db, slug) {
  const result = await db.prepare("SELECT * FROM feeds WHERE slug = ?").bind(slug).first();
  return result ?? null;
}

export async function getFeedByUrl(db, url) {
  const result = await db.prepare("SELECT * FROM feeds WHERE source_url = ?").bind(url).first();
  return result ?? null;
}

// A new feed is born with its first read already requested: nothing else will
// ever fetch a list nobody has claimed, and a feed with no snapshot serves
// nothing but a 503.
async function insertFeed(db, normalized) {
  const slug = await createStableSlug(normalized.canonicalUrl);
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO feeds (slug, source_url, source_kind, status, refresh_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`
    )
    .bind(slug, normalized.canonicalUrl, normalized.sourceKind, timestamp, timestamp, timestamp)
    .run();
  return getFeedBySlug(db, slug);
}

export async function getOrCreateFeed(db, normalized) {
  const existing = await getFeedByUrl(db, normalized.canonicalUrl);
  if (existing) {
    return existing;
  }

  return insertFeed(db, normalized);
}

export async function getFeedItems(db, feedId) {
  const result = await db
    .prepare("SELECT imdb_id, tvdb_id, position, title, year, title_type, added_at FROM feed_items WHERE feed_id = ? ORDER BY position ASC")
    .bind(feedId)
    .all();
  return result.results ?? [];
}

export async function storeFeedSnapshot(db, feed, snapshot) {
  const timestamp = nowIso();
  const storedItems = snapshot.items;

  // The rows are replaced wholesale, so carry forward the TVDB ids already
  // resolved for these titles. Without this every sync drops them and the
  // Sonarr list re-resolves the whole series set through TVMaze.
  const previousItems = await getFeedItems(db, feed.id);
  const knownTvdbIds = new Map(
    previousItems.filter((item) => item.tvdb_id).map((item) => [item.imdb_id, item.tvdb_id]),
  );

  const statements = [db.prepare("DELETE FROM feed_items WHERE feed_id = ?").bind(feed.id)];

  for (const item of storedItems) {
    const tvdbId = item.tvdbId ?? knownTvdbIds.get(item.imdbId) ?? null;
    statements.push(
      db.prepare(
        `INSERT INTO feed_items (feed_id, imdb_id, tvdb_id, position, title, year, title_type, added_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(feed.id, item.imdbId, tvdbId, item.position, item.title, item.year, item.titleType, item.addedAt, timestamp)
    );
  }

  statements.push(
    db.prepare(
      `UPDATE feeds
       SET list_title = ?, list_author = ?, list_id = ?, status = 'ready', item_count = ?, last_error = NULL,
           consecutive_failures = 0, refresh_requested_at = NULL, last_synced_at = ?, last_source_modified_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(
      snapshot.listTitle || snapshot.sourceTitle,
      snapshot.listAuthor || "",
      snapshot.listId || "",
      storedItems.length,
      timestamp,
      snapshot.lastSourceModifiedAt,
      timestamp,
      feed.id,
    )
  );

  await db.batch(statements);
  return {
    ...feed,
    list_title: snapshot.listTitle || snapshot.sourceTitle,
    list_author: snapshot.listAuthor || "",
    list_id: snapshot.listId || "",
    status: "ready",
    item_count: storedItems.length,
    last_error: null,
    consecutive_failures: 0,
    refresh_requested_at: null,
    last_synced_at: timestamp,
    last_source_modified_at: snapshot.lastSourceModifiedAt,
    updated_at: timestamp,
  };
}

export async function storeFeedCaches(db, feed, { radarrCache, sonarrCache, sourceFingerprint }) {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE feeds
       SET source_fingerprint = ?, radarr_cache = ?, sonarr_cache = ?, cache_updated_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(sourceFingerprint, radarrCache, sonarrCache, timestamp, timestamp, feed.id)
    .run();

  return {
    ...feed,
    source_fingerprint: sourceFingerprint,
    radarr_cache: radarrCache,
    sonarr_cache: sonarrCache,
    cache_updated_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Record a failed read. consecutive_failures counts up here and only here, so
 * a run of bad syncs is visible even though each overwrites last_error; a
 * successful sync resets it. A pending request is dropped when the failure is
 * permanent (the list is private or gone) or has now happened `giveUpAfter`
 * times in a row, so a dead list stops costing every run an IMDb call. A
 * claimed feed stays on the schedule regardless: its owner is told, and it
 * recovers by itself the moment the list is made public again.
 */
export async function markFeedFailure(db, feedId, error, { permanent = false, giveUpAfter }) {
  await db
    .prepare(
      `UPDATE feeds
       SET status = 'error', last_error = ?, consecutive_failures = consecutive_failures + 1,
           refresh_requested_at = CASE WHEN ? OR consecutive_failures + 1 >= ? THEN NULL ELSE refresh_requested_at END,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(String(error), permanent ? 1 : 0, giveUpAfter, nowIso(), feedId)
    .run();
}

export async function markFeedUnchanged(db, feed, sourceFingerprint) {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE feeds
       SET source_fingerprint = ?, status = 'ready', last_error = NULL, consecutive_failures = 0,
           refresh_requested_at = NULL, last_synced_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(sourceFingerprint, timestamp, timestamp, feed.id)
    .run();

  return {
    ...feed,
    source_fingerprint: sourceFingerprint,
    status: "ready",
    last_error: null,
    consecutive_failures: 0,
    refresh_requested_at: null,
    last_synced_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Ask the sync job to read this feed on its next run. An earlier request keeps
 * its place in the queue rather than being pushed to the back.
 */
export async function requestRefresh(db, feed) {
  const requestedAt = feed.refresh_requested_at ?? nowIso();
  await db
    .prepare("UPDATE feeds SET refresh_requested_at = COALESCE(refresh_requested_at, ?) WHERE id = ?")
    .bind(requestedAt, feed.id)
    .run();
  return { ...feed, refresh_requested_at: requestedAt };
}

export async function saveTvdbIds(db, feedId, resolutions) {
  await db.batch(
    resolutions.map(({ imdbId, tvdbId }) =>
      db.prepare("UPDATE feed_items SET tvdb_id = ? WHERE feed_id = ? AND imdb_id = ?").bind(tvdbId, feedId, imdbId),
    ),
  );
}

export async function claimFeed(db, feedId, sub) {
  await db
    .prepare("INSERT OR IGNORE INTO feed_owners (feed_id, owner_sub, created_at) VALUES (?, ?, ?)")
    .bind(feedId, sub, nowIso())
    .run();
}

export async function releaseFeed(db, feedId, sub) {
  await db.prepare("DELETE FROM feed_owners WHERE feed_id = ? AND owner_sub = ?").bind(feedId, sub).run();
}

export async function isFeedOwnedBy(db, feedId, sub) {
  if (!sub) {
    return false;
  }

  const row = await db
    .prepare("SELECT 1 AS owned FROM feed_owners WHERE feed_id = ? AND owner_sub = ?")
    .bind(feedId, sub)
    .first();
  return Boolean(row);
}

export async function hasAnyOwner(db, feedId) {
  const row = await db.prepare("SELECT 1 AS owned FROM feed_owners WHERE feed_id = ? LIMIT 1").bind(feedId).first();
  return Boolean(row);
}

const SYNC_TARGET_COLUMNS = `f.source_url, f.source_kind, f.status, f.last_synced_at, f.source_fingerprint,
       f.refresh_requested_at, EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id) AS owned`;

/**
 * What the sync job should read. Requested reads come first, oldest request
 * first, because a person is waiting on each of them; then every claimed feed,
 * least recently synced first. `scope: "requested"` is the dispatched run a
 * pasted list triggers, which only needs the queue.
 */
export async function readSyncTargets(db, { scope = "all" } = {}) {
  const requested = await db
    .prepare(
      `SELECT ${SYNC_TARGET_COLUMNS}
         FROM feeds f
        WHERE f.refresh_requested_at IS NOT NULL
        ORDER BY f.refresh_requested_at ASC
        LIMIT ?`,
    )
    .bind(REQUESTED_FEEDS_PER_RUN)
    .all();

  if (scope === "requested") {
    return requested.results ?? [];
  }

  const owned = await db
    .prepare(
      `SELECT ${SYNC_TARGET_COLUMNS}
         FROM feeds f
        WHERE f.refresh_requested_at IS NULL
          AND EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id)
        ORDER BY f.last_synced_at IS NULL DESC, f.last_synced_at ASC`,
    )
    .all();

  return [...(requested.results ?? []), ...(owned.results ?? [])];
}

export async function readOwnedFeeds(db, sub) {
  const result = await db
    .prepare(
      `SELECT f.slug, f.source_url, f.source_kind, f.list_title, f.status, f.item_count, f.last_synced_at,
              f.last_error, f.consecutive_failures
         FROM feeds f JOIN feed_owners o ON o.feed_id = f.id
        WHERE o.owner_sub = ?
        ORDER BY f.list_title`,
    )
    .bind(sub)
    .all();
  return result.results ?? [];
}

export async function readAlertingFeeds(db, sub, threshold) {
  const result = await db
    .prepare(
      `SELECT f.slug, f.list_title, f.consecutive_failures, f.last_error
         FROM feeds f JOIN feed_owners o ON o.feed_id = f.id
        WHERE o.owner_sub = ? AND f.consecutive_failures >= ?
        ORDER BY f.consecutive_failures DESC`,
    )
    .bind(sub, threshold)
    .all();
  return result.results ?? [];
}
