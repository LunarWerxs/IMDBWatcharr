// Every D1 statement the Worker runs, in one place, so the route handlers read
// as HTTP and the SQL reads as SQL.

import { hashText, MOVIE_TITLE_TYPES, SERIES_TITLE_TYPES } from "./imdb.js";

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
// nine to an INSERT rather than one each.
const ITEM_COLUMNS = [
  "feed_id",
  "imdb_id",
  "tvdb_id",
  "tmdb_id",
  "position",
  "title",
  "year",
  "title_type",
  "added_at",
  "poster_url",
  "created_at",
];
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

/**
 * The feed for a list, made if it is new. A new one comes back `created`: its
 * first read is already queued, and it is the caller's to hurry that read.
 */
export async function getOrCreateFeed(db, normalized) {
  return (await getFeedByUrl(db, normalized.canonicalUrl)) ?? { ...(await insertFeed(db, normalized)), created: true };
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

const SERIES_TYPES = [...SERIES_TITLE_TYPES];
const MOVIE_TYPES = [...MOVIE_TITLE_TYPES];
const placeholders = (values) => values.map(() => "?").join(", ");

/**
 * The TVDB and TMDB ids already found for a feed's titles, which a new snapshot
 * carries forward. A TMDB miss (0) is not carried, so a changed list asks again.
 */
export async function readKnownIds(db, feedId) {
  const result = await db
    .prepare("SELECT imdb_id, tvdb_id, tmdb_id FROM feed_items WHERE feed_id = ? AND (tvdb_id IS NOT NULL OR tmdb_id > 0)")
    .bind(feedId)
    .all();
  return new Map(
    (result.results ?? []).map((row) => [row.imdb_id, { tvdbId: row.tvdb_id ?? null, tmdbId: row.tmdb_id > 0 ? row.tmdb_id : null }]),
  );
}

/** The IMDb ids of a feed's shows that have no TVDB id yet. */
export async function readUnresolvedSeries(db, feedId) {
  const result = await db
    .prepare(`SELECT imdb_id FROM feed_items WHERE feed_id = ? AND tvdb_id IS NULL AND title_type IN (${placeholders(SERIES_TYPES)})`)
    .bind(feedId, ...SERIES_TYPES)
    .all();
  return (result.results ?? []).map((row) => row.imdb_id);
}

/**
 * The next `limit` of a feed's movies not yet looked up on TMDB, first on the
 * list first, and how many there are in all.
 */
export async function readUnresolvedMovies(db, feedId, limit) {
  const where = `feed_id = ? AND tmdb_id IS NULL AND title_type IN (${placeholders(MOVIE_TYPES)})`;
  const [count, next] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM feed_items WHERE ${where}`).bind(feedId, ...MOVIE_TYPES),
    db.prepare(`SELECT imdb_id FROM feed_items WHERE ${where} ORDER BY position ASC LIMIT ?`).bind(feedId, ...MOVIE_TYPES, limit),
  ]);
  return { total: count.results?.[0]?.total ?? 0, imdbIds: (next.results ?? []).map((row) => row.imdb_id) };
}

/**
 * What Radarr's or Sonarr's own list type reads: the movies with a TMDB id, or
 * the shows with a TVDB id, in list order. Only the three columns it serves.
 */
export async function readArrItems(db, feedId, feedTarget) {
  const [idColumn, types] = feedTarget === "radarr" ? ["tmdb_id", MOVIE_TYPES] : ["tvdb_id", SERIES_TYPES];
  const result = await db
    .prepare(
      `SELECT ${idColumn} AS id, title, year FROM feed_items
        WHERE feed_id = ? AND ${idColumn} > 0 AND title_type IN (${placeholders(types)}) ORDER BY position ASC`,
    )
    .bind(feedId, ...types)
    .all();
  return result.results ?? [];
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
            item.tmdb_id,
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

// One UPDATE per this many titles: an id and an IMDb id in the CASE, the IMDb
// id again in the IN list, plus the feed, stay under D1's 100 bound values.
const IDS_PER_UPDATE = 30;

// `column` is tvdb_id or tmdb_id, never input.
function setIds(db, feedId, column, ids) {
  const pairs = [...ids];
  const statements = [];
  for (let offset = 0; offset < pairs.length; offset += IDS_PER_UPDATE) {
    const chunk = pairs.slice(offset, offset + IDS_PER_UPDATE);
    statements.push(
      db
        .prepare(
          `UPDATE feed_items SET ${column} = CASE imdb_id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
            WHERE feed_id = ? AND imdb_id IN (${placeholders(chunk)})`,
        )
        .bind(...chunk.flat(), feedId, ...chunk.map(([imdbId]) => imdbId)),
    );
  }
  return statements;
}

/** Save ids found for titles already stored and set `fields` on the feed, in one round trip. */
export async function updateFeedAndIds(db, feed, fields, { tvdb = new Map(), tmdb = new Map() } = {}) {
  const statements = [
    ...setIds(db, feed.id, "tvdb_id", tvdb),
    ...setIds(db, feed.id, "tmdb_id", tmdb),
    ...(Object.keys(fields).length ? [updateFeed(db, feed.id, fields)] : []),
  ];
  if (statements.length) {
    await db.batch(statements);
  }
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

/** Whether anyone keeps this feed current: a person who claimed it, or a shared list it feeds. */
export async function hasAnyOwner(db, feedId) {
  const row = await db
    .prepare(
      `SELECT 1 AS owned FROM feed_owners WHERE feed_id = ?
       UNION ALL SELECT 1 FROM shared_list_sources WHERE feed_id = ?
       LIMIT 1`,
    )
    .bind(feedId, feedId)
    .first();
  return Boolean(row);
}

const SYNC_TARGET_COLUMNS = "f.source_url, f.last_synced_at, f.refresh_requested_at";

// A feed is kept on the schedule while somebody wants it: a person who claimed
// it, or a shared list it feeds.
const CLAIMED = "EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id)";
const SHARED = "EXISTS (SELECT 1 FROM shared_list_sources s WHERE s.feed_id = f.id)";

// A claimed feed read more recently than this is skipped by a dispatched run:
// the schedule has it in hand, and the dispatched run is about the queue.
const OWNED_DUE_AFTER_MS = 1000 * 60 * 10;

/**
 * What the sync job should read, in order: claimed feeds (a person's, or a
 * shared list's) with a pending request (a signed-in person is waiting on
 * each), then signed-out requests,
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
          WHERE ${CLAIMED} OR ${SHARED}
          ORDER BY f.refresh_requested_at IS NULL ASC, f.refresh_requested_at ASC,
                   f.last_synced_at IS NULL DESC, f.last_synced_at ASC`,
      )
      .all(),
    db
      .prepare(
        `SELECT ${SYNC_TARGET_COLUMNS}
           FROM feeds f
          WHERE f.refresh_requested_at IS NOT NULL
            AND NOT ${CLAIMED} AND NOT ${SHARED}
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

// ── Shared lists ─────────────────────────────────────────────────────────────
// One Radarr link and one Sonarr link fed by several IMDb lists, which several
// signed-in people can add to (migrations/0010_add_shared_lists.sql).

/** Random lowercase hex, `bytes` long before encoding: slugs and invite codes. */
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const SHARED_LIST_COLUMNS = "l.id, l.slug, l.invite_code, l.name, l.owner_sub, l.created_at, l.updated_at";

// Every shared list the person belongs to, as a subquery the reads below share.
const MY_SHARED_LISTS = "SELECT shared_list_id FROM shared_list_members WHERE member_sub = ?";

function touchSharedList(db, listId) {
  return db.prepare("UPDATE shared_lists SET updated_at = ? WHERE id = ?").bind(nowIso(), listId);
}

/** A new shared list with its owner as its first member, in one batch. Returns its slug. */
export async function createSharedList(db, { name, sub, memberName }) {
  const timestamp = nowIso();
  const slug = randomHex(6);
  await db.batch([
    db
      .prepare(
        `INSERT INTO shared_lists (slug, invite_code, name, owner_sub, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(slug, randomHex(16), name, sub, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO shared_list_members (shared_list_id, member_sub, member_name, joined_at)
         SELECT id, ?, ?, ? FROM shared_lists WHERE slug = ?`,
      )
      .bind(sub, memberName, timestamp, slug),
  ]);
  return slug;
}

export async function countOwnedSharedLists(db, sub) {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM shared_lists WHERE owner_sub = ?").bind(sub).first();
  return row?.total ?? 0;
}

/** A shared list by its public slug, for the feed routes: nobody's membership involved. */
export async function getSharedListBySlug(db, slug) {
  const row = await db.prepare("SELECT id, slug, name, updated_at FROM shared_lists WHERE slug = ?").bind(slug).first();
  return row ?? null;
}

/** A shared list this person belongs to, with their own member row's id; null for anyone else. */
export async function getSharedListForMember(db, slug, sub) {
  const row = await db
    .prepare(
      `SELECT ${SHARED_LIST_COLUMNS}, m.id AS member_id,
              (SELECT COUNT(*) FROM shared_list_sources s WHERE s.shared_list_id = l.id) AS source_count
         FROM shared_lists l JOIN shared_list_members m ON m.shared_list_id = l.id
        WHERE l.slug = ? AND m.member_sub = ?`,
    )
    .bind(slug, sub)
    .first();
  return row ?? null;
}

/** What a join link shows before anyone joins: the list's name, who made it, how big it is. */
export async function getSharedListByInvite(db, inviteCode) {
  const row = await db
    .prepare(
      `SELECT ${SHARED_LIST_COLUMNS},
              (SELECT member_name FROM shared_list_members m WHERE m.shared_list_id = l.id AND m.member_sub = l.owner_sub) AS owner_name,
              (SELECT COUNT(*) FROM shared_list_sources s WHERE s.shared_list_id = l.id) AS source_count,
              (SELECT COUNT(*) FROM shared_list_members m WHERE m.shared_list_id = l.id) AS member_count
         FROM shared_lists l
        WHERE l.invite_code = ?`,
    )
    .bind(inviteCode)
    .first();
  return row ?? null;
}

/** Join a shared list; joining one already joined just refreshes the name the others see. */
export async function joinSharedList(db, listId, sub, memberName) {
  await db
    .prepare(
      `INSERT INTO shared_list_members (shared_list_id, member_sub, member_name, joined_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (shared_list_id, member_sub) DO UPDATE SET member_name = COALESCE(excluded.member_name, member_name)`,
    )
    .bind(listId, sub, memberName, nowIso())
    .run();
}

/**
 * Every shared list this person belongs to, with each one's members, the IMDb
 * lists feeding it, and how many distinct movies and shows it serves.
 */
export async function readSharedListsFor(db, sub) {
  const [lists, members, sources, counts] = await Promise.all([
    db
      .prepare(
        `SELECT ${SHARED_LIST_COLUMNS}
           FROM shared_lists l JOIN shared_list_members m ON m.shared_list_id = l.id
          WHERE m.member_sub = ?
          ORDER BY l.created_at, l.id`,
      )
      .bind(sub)
      .all(),
    db
      .prepare(
        `SELECT id, shared_list_id, member_sub, member_name FROM shared_list_members
          WHERE shared_list_id IN (${MY_SHARED_LISTS})
          ORDER BY joined_at, id`,
      )
      .bind(sub)
      .all(),
    db
      .prepare(
        `SELECT s.shared_list_id, s.added_by_sub, f.slug, f.source_url, f.list_title, f.status, f.item_count,
                f.last_synced_at, f.last_error, f.consecutive_failures
           FROM shared_list_sources s JOIN feeds f ON f.id = s.feed_id
          WHERE s.shared_list_id IN (${MY_SHARED_LISTS})
          ORDER BY s.created_at, s.feed_id`,
      )
      .bind(sub)
      .all(),
    db
      .prepare(
        `SELECT s.shared_list_id,
                COUNT(DISTINCT CASE WHEN i.title_type IN (${placeholders(MOVIE_TYPES)}) THEN i.imdb_id END) AS movies,
                COUNT(DISTINCT CASE WHEN i.title_type IN (${placeholders(SERIES_TYPES)}) AND i.tvdb_id > 0 THEN i.imdb_id END) AS shows
           FROM shared_list_sources s JOIN feed_items i ON i.feed_id = s.feed_id
          WHERE s.shared_list_id IN (${MY_SHARED_LISTS})
          GROUP BY s.shared_list_id`,
      )
      .bind(...MOVIE_TYPES, ...SERIES_TYPES, sub)
      .all(),
  ]);
  return {
    lists: lists.results ?? [],
    members: members.results ?? [],
    sources: sources.results ?? [],
    counts: counts.results ?? [],
  };
}

/** Add an IMDb list's feed to a shared list. False when it was already there. */
export async function addSharedSource(db, listId, feedId, sub) {
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO shared_list_sources (shared_list_id, feed_id, added_by_sub, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(listId, feedId, sub, nowIso()),
    touchSharedList(db, listId),
  ]);
  return (insert?.meta?.changes ?? 1) === 1;
}

/** Take a list out of a shared list; with `addedBy`, only if that person added it. True when it went. */
export async function removeSharedSource(db, listId, feedSlug, addedBy = null) {
  const onlyTheirs = addedBy ? " AND added_by_sub = ?" : "";
  const [removal] = await db.batch([
    db
      .prepare(
        `DELETE FROM shared_list_sources
          WHERE shared_list_id = ? AND feed_id = (SELECT id FROM feeds WHERE slug = ?)${onlyTheirs}`,
      )
      .bind(listId, feedSlug, ...(addedBy ? [addedBy] : [])),
    touchSharedList(db, listId),
  ]);
  return (removal?.meta?.changes ?? 1) > 0;
}

/** Someone leaves, or is removed from, a shared list, and the lists they added go with them. */
export async function removeSharedMember(db, listId, memberId) {
  const member = "SELECT member_sub FROM shared_list_members WHERE id = ? AND shared_list_id = ?";
  await db.batch([
    db
      .prepare(`DELETE FROM shared_list_sources WHERE shared_list_id = ? AND added_by_sub = (${member})`)
      .bind(listId, memberId, listId),
    db.prepare("DELETE FROM shared_list_members WHERE id = ? AND shared_list_id = ?").bind(memberId, listId),
    touchSharedList(db, listId),
  ]);
}

export async function renameSharedList(db, listId, name) {
  await db.prepare("UPDATE shared_lists SET name = ?, updated_at = ? WHERE id = ?").bind(name, nowIso(), listId).run();
}

/** A new join link; the old one stops working. Everyone already in stays in. */
export async function resetSharedInvite(db, listId) {
  await db.prepare("UPDATE shared_lists SET invite_code = ? WHERE id = ?").bind(randomHex(16), listId).run();
}

export async function deleteSharedList(db, listId) {
  await db.batch([
    db.prepare("DELETE FROM shared_list_sources WHERE shared_list_id = ?").bind(listId),
    db.prepare("DELETE FROM shared_list_members WHERE shared_list_id = ?").bind(listId),
    db.prepare("DELETE FROM shared_lists WHERE id = ?").bind(listId),
  ]);
}

/** Where each IMDb list feeding a shared list stands, for its links' status and ETag. */
export async function readSharedSourceFeeds(db, listId) {
  const result = await db
    .prepare(
      `SELECT f.id, f.list_title, f.status, f.last_synced_at, f.last_error, f.refresh_requested_at,
              f.source_fingerprint, f.cache_updated_at
         FROM shared_list_sources s JOIN feeds f ON f.id = s.feed_id
        WHERE s.shared_list_id = ?
        ORDER BY s.created_at, s.feed_id`,
    )
    .bind(listId)
    .all();
  return result.results ?? [];
}

/**
 * The titles a shared list serves one app, from every IMDb list feeding it:
 * the first list added first, each in its own order, each title tagged with the
 * list it came from. A title on two lists comes back twice; the caller keeps one.
 */
export async function readSharedItems(db, listId, feedTarget) {
  const types = feedTarget === "radarr" ? MOVIE_TYPES : SERIES_TYPES;
  const result = await db
    .prepare(
      `SELECT i.imdb_id, i.tvdb_id, i.tmdb_id, i.title, i.year, i.title_type, i.added_at, f.list_title AS source_title
         FROM shared_list_sources s
         JOIN feed_items i ON i.feed_id = s.feed_id
         JOIN feeds f ON f.id = s.feed_id
        WHERE s.shared_list_id = ? AND i.title_type IN (${placeholders(types)})
        ORDER BY s.created_at, s.feed_id, i.position`,
    )
    .bind(listId, ...types)
    .all();
  return result.results ?? [];
}
