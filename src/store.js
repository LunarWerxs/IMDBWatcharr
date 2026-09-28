// Every D1 statement the Worker runs, in one place, so the route handlers read
// as HTTP and the SQL reads as SQL.

import { hashText, SERIES_TITLE_TYPES } from "./imdb.js";

// A claimed feed older than this is re-fetched when Radarr or Sonarr polls it.
const STALE_AFTER_MS = 1000 * 60 * 60 * 6;

// How many signed-out feeds one sync run may pick up. Anyone can queue a list,
// so the queue is bounded per run rather than trusted to stay small; the rest
// wait for the next run, oldest request first.
const REQUESTED_FEEDS_PER_RUN = 50;

// Every column but the two stored bodies. Those run to hundreds of kB (a
// 2,200-title list's RSS is 690 kB), and only a feed route serves one, so only
// it asks for one: the one it serves.
const FEED_COLUMNS = `id, slug, source_url, source_kind, list_title, list_author, list_id, status, item_count,
  last_error, consecutive_failures, last_synced_at, last_source_modified_at, source_fingerprint, cache_updated_at,
  refresh_requested_at, created_at, updated_at`;
const CACHE_COLUMNS = { radarr: "radarr_cache", sonarr: "sonarr_cache" };

// D1 binds at most 100 parameters to one statement, so a snapshot's rows go in
// ten to an INSERT rather than one each.
const ITEM_COLUMNS = ["feed_id", "imdb_id", "tvdb_id", "position", "title", "year", "title_type", "added_at", "poster_url", "created_at"];
const ITEMS_PER_INSERT = Math.floor(100 / ITEM_COLUMNS.length);
const ITEM_ROW = `(${ITEM_COLUMNS.map(() => "?").join(", ")})`;

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
  const result = await db.prepare(`SELECT ${FEED_COLUMNS} FROM feeds WHERE slug = ?`).bind(slug).first();
  return result ?? null;
}

/** A feed by its IMDb URL; with a target, plus the stored body that target serves. */
export async function getFeedByUrl(db, url, feedTarget) {
  const columns = feedTarget ? `${FEED_COLUMNS}, ${CACHE_COLUMNS[feedTarget]}` : FEED_COLUMNS;
  const result = await db.prepare(`SELECT ${columns} FROM feeds WHERE source_url = ?`).bind(url).first();
  return result ?? null;
}

// A new feed is born with its first read already requested: nothing else will
// ever fetch a list nobody has claimed, and a feed with no snapshot serves
// nothing but a 503. Two pastes of the same new list at once both get the row.
async function insertFeed(db, normalized) {
  const timestamp = nowIso();
  return db
    .prepare(
      `INSERT INTO feeds (slug, source_url, source_kind, status, refresh_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT (source_url) DO UPDATE SET source_url = excluded.source_url
       RETURNING ${FEED_COLUMNS}`,
    )
    .bind(await hashText(normalized.canonicalUrl, 12), normalized.canonicalUrl, normalized.sourceKind, timestamp, timestamp, timestamp)
    .first();
}

export async function getOrCreateFeed(db, normalized) {
  return (await getFeedByUrl(db, normalized.canonicalUrl)) ?? insertFeed(db, normalized);
}

export async function getFeedItems(db, feedId) {
  const result = await db
    .prepare(
      "SELECT imdb_id, tvdb_id, position, title, year, title_type, added_at, poster_url FROM feed_items WHERE feed_id = ? ORDER BY position ASC",
    )
    .bind(feedId)
    .all();
  return result.results ?? [];
}

/** The TVDB ids already resolved for a feed's titles, which a new snapshot carries forward. */
export async function readKnownTvdbIds(db, feedId) {
  const result = await db
    .prepare("SELECT imdb_id, tvdb_id FROM feed_items WHERE feed_id = ? AND tvdb_id IS NOT NULL")
    .bind(feedId)
    .all();
  return new Map((result.results ?? []).map((row) => [row.imdb_id, row.tvdb_id]));
}

/** The IMDb ids of a feed's shows that have no TVDB id yet. */
export async function readUnresolvedSeries(db, feedId) {
  const types = [...SERIES_TITLE_TYPES];
  const result = await db
    .prepare(
      `SELECT imdb_id FROM feed_items
        WHERE feed_id = ? AND tvdb_id IS NULL AND title_type IN (${types.map(() => "?").join(", ")})`,
    )
    .bind(feedId, ...types)
    .all();
  return (result.results ?? []).map((row) => row.imdb_id);
}

// `fields` only ever holds column names written in this codebase, never input.
function updateFeed(db, feedId, fields) {
  const columns = Object.keys(fields);
  return db
    .prepare(`UPDATE feeds SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
    .bind(...Object.values(fields), feedId);
}

/** Replace a feed's titles with a new snapshot and set `fields` on it, in one batch. */
export async function replaceFeedItems(db, feed, items, fields) {
  const timestamp = nowIso();
  const inserts = [];
  for (let offset = 0; offset < items.length; offset += ITEMS_PER_INSERT) {
    const rows = items.slice(offset, offset + ITEMS_PER_INSERT);
    inserts.push(
      db
        .prepare(`INSERT INTO feed_items (${ITEM_COLUMNS.join(", ")}) VALUES ${rows.map(() => ITEM_ROW).join(", ")}`)
        .bind(
          ...rows.flatMap((item) => [
            feed.id,
            item.imdb_id,
            item.tvdb_id,
            item.position,
            item.title,
            item.year,
            item.title_type,
            item.added_at,
            item.poster_url,
            timestamp,
          ]),
        ),
    );
  }

  await db.batch([
    db.prepare("DELETE FROM feed_items WHERE feed_id = ?").bind(feed.id),
    ...inserts,
    updateFeed(db, feed.id, fields),
  ]);
  return { ...feed, ...fields };
}

/** Save TVDB ids found for titles already stored and set `fields` on the feed, in one round trip. */
export async function updateFeedAndTvdbIds(db, feed, fields, tvdbIds = new Map()) {
  await db.batch([
    ...[...tvdbIds].map(([imdbId, tvdbId]) =>
      db.prepare("UPDATE feed_items SET tvdb_id = ? WHERE feed_id = ? AND imdb_id = ?").bind(tvdbId, feed.id, imdbId),
    ),
    updateFeed(db, feed.id, fields),
  ]);
  return { ...feed, ...fields };
}

// How long a request that keeps failing stays in the queue. Measured in time,
// not in runs: a run-wide IMDb outage fails every read in several runs back to
// back, and counting those would drop every waiting list for good.
const GIVE_UP_AFTER_MS = 1000 * 60 * 60 * 24;

/**
 * Record a failed read. consecutive_failures counts up here and only here, so
 * a run of bad syncs is visible even though each overwrites last_error; a
 * successful sync resets it. A pending request is dropped when the failure is
 * permanent (the list is private or gone), or when it has failed `giveUpAfter`
 * times in a row AND has been waiting a full day, so a dead list stops costing
 * every run an IMDb call while an outage does not empty the queue. A claimed
 * feed stays on the schedule regardless: its owner is told, and it recovers by
 * itself the moment the list is made public again.
 */
export async function markFeedFailure(db, feedId, error, { permanent = false, giveUpAfter }) {
  const now = Date.now();
  await db
    .prepare(
      `UPDATE feeds
       SET status = 'error', last_error = ?, consecutive_failures = consecutive_failures + 1,
           refresh_requested_at = CASE
             WHEN ? THEN NULL
             WHEN consecutive_failures + 1 >= ? AND refresh_requested_at < ? THEN NULL
             ELSE refresh_requested_at
           END,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      String(error),
      permanent ? 1 : 0,
      giveUpAfter,
      new Date(now - GIVE_UP_AFTER_MS).toISOString(),
      new Date(now).toISOString(),
      feedId,
    )
    .run();
}

/**
 * Ask the sync job to read this feed on its next run. An earlier request keeps
 * its place in the queue rather than being pushed to the back. `queued` says
 * whether this call is what put it there, which is when a dispatch is worth it.
 */
export async function requestRefresh(db, feed) {
  if (feed.refresh_requested_at) {
    return { feed, queued: false };
  }

  const requestedAt = nowIso();
  await db
    .prepare("UPDATE feeds SET refresh_requested_at = COALESCE(refresh_requested_at, ?) WHERE id = ?")
    .bind(requestedAt, feed.id)
    .run();
  return { feed: { ...feed, refresh_requested_at: requestedAt }, queued: true };
}

/**
 * Claim the one dispatch slot for the next `intervalMs`. True for exactly one
 * caller per interval, however many pastes arrive at once, so a burst of
 * visitors (or someone scripting /api/create) cannot turn into a burst of
 * GitHub API calls on the owner's token.
 */
export async function claimDispatchSlot(db, intervalMs) {
  const now = Date.now();
  const result = await db
    .prepare("UPDATE sync_dispatch SET last_at = ? WHERE id = 1 AND last_at < ?")
    .bind(new Date(now).toISOString(), new Date(now - intervalMs).toISOString())
    .run();
  return (result?.meta?.changes ?? 0) === 1;
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

const SYNC_TARGET_COLUMNS = "f.source_url, f.last_synced_at, f.refresh_requested_at";

// A claimed feed read more recently than this is skipped by a dispatched run:
// the schedule has it in hand, and the dispatched run is about the queue.
const OWNED_DUE_AFTER_MS = 1000 * 60 * 10;

/**
 * What the sync job should read, in order: claimed feeds with a pending
 * request (a signed-in person is waiting on each), then signed-out requests,
 * oldest first and at most REQUESTED_FEEDS_PER_RUN of them, then every other
 * claimed feed, least recently synced first. The cap applies to signed-out
 * requests only, so however long that queue gets, no claimed feed is ever left
 * out of a run.
 *
 * `scope: "requested"` is the run a pasted list dispatches. It skips claimed
 * feeds synced in the last ten minutes but keeps the rest, because a dispatch
 * can replace a scheduled run that was waiting in the same concurrency group,
 * and the claimed feeds must not miss that tick.
 */
export async function readSyncTargets(db, { scope = "all" } = {}) {
  const [owned, guests] = await Promise.all([
    db
      .prepare(
        `SELECT ${SYNC_TARGET_COLUMNS}
           FROM feeds f
          WHERE EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id)
          ORDER BY f.refresh_requested_at IS NULL ASC, f.refresh_requested_at ASC,
                   f.last_synced_at IS NULL DESC, f.last_synced_at ASC`,
      )
      .all(),
    db
      .prepare(
        `SELECT ${SYNC_TARGET_COLUMNS}
           FROM feeds f
          WHERE f.refresh_requested_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id)
          ORDER BY f.refresh_requested_at ASC
          LIMIT ?`,
      )
      .bind(REQUESTED_FEEDS_PER_RUN)
      .all(),
  ]);

  const ownedRows = (owned.results ?? []).map((feed) => ({ ...feed, owned: true }));
  const guestRows = (guests.results ?? []).map((feed) => ({ ...feed, owned: false }));
  const ownedRequested = ownedRows.filter((feed) => feed.refresh_requested_at);
  let ownedRest = ownedRows.filter((feed) => !feed.refresh_requested_at);

  if (scope === "requested") {
    const dueBefore = Date.now() - OWNED_DUE_AFTER_MS;
    ownedRest = ownedRest.filter((feed) => !feed.last_synced_at || Date.parse(feed.last_synced_at) < dueBefore);
  }

  return [...ownedRequested, ...guestRows, ...ownedRest];
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
