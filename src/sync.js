// The sync job's half of the Worker.
//
// IMDb refuses every request from Cloudflare's egress, so the Worker cannot
// fetch its own data. A GitHub Actions run (scripts/sync-feeds.mjs) asks
// /api/sync-targets what to read, reads it from IMDb, and hands each result
// back through /api/ingest, then asks /api/resolve-ids for the rest of a big
// list's TMDB ids. All three routes are shared-secret authenticated.
//
// What gets read: every claimed feed, on every run, and any feed somebody has
// asked for (refresh_requested_at), whether or not they signed in. A new feed
// is asked for the moment it is created, which is what gives a signed-out
// visitor their first snapshot.

import {
  buildCachedFeedXmlTemplate,
  buildSonarrCustomListPayload,
  FEED_ALERT_FAILURE_THRESHOLD,
  filterItemsForTarget,
  hashText,
  imdbPosterUrl,
  normalizeImdbUrl,
} from "./imdb.js";
import { buildSnapshotFingerprintPayload } from "./imdb-graphql.js";
import { json } from "./http.js";
import {
  claimDispatchSlot,
  getFeedByUrl,
  getFeedItems,
  getOrCreateFeed,
  markFeedFailure,
  nowIso,
  readKnownIds,
  readSyncTargets,
  readUnresolvedMovies,
  readUnresolvedSeries,
  replaceFeedItems,
  updateFeedAndIds,
} from "./store.js";
import { resolveTmdbIds, resolveTvdbIds } from "./external-ids.js";

// The workflow a pasted list dispatches. workflow_dispatch needs only the
// token's Actions permission, where repository_dispatch would need write
// access to the repository's contents.
const SYNC_WORKFLOW_FILE = "sync-feeds.yml";
const SYNC_WORKFLOW_REF = "main";

// At most one dispatch per minute, whoever is pasting: every dispatched run
// reads the whole queue, so the lists pasted in between ride along.
const DISPATCH_INTERVAL_MS = 60_000;
// GitHub normally answers a dispatch in well under a second; past this, give up
// rather than hold a Worker invocation open (the queue still has the list).
const DISPATCH_TIMEOUT_MS = 4_000;

// Movies looked up on TMDB per request, one call each: comfortably inside a
// Worker's subrequest limit. A bigger list gets the rest through
// /api/resolve-ids, which the runner calls until none are left.
const MOVIE_LOOKUPS_PER_REQUEST = 250;

// Length-independent comparison, so a wrong secret cannot be narrowed down by
// timing the reply.
function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

function isAuthorizedSyncRequest(request, env) {
  // No configured secret means no ingest, rather than an open write endpoint.
  if (!env.INGEST_SECRET) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretsMatch(presented, env.INGEST_SECRET);
}

function snapshotItemProblem(item, seen) {
  if (!/^tt\d+$/.test(String(item?.imdbId))) {
    return `Snapshot item has a bad IMDb id: ${item?.imdbId}`;
  }
  if (seen.has(item.imdbId)) {
    return `Snapshot repeats ${item.imdbId}.`;
  }
  if (typeof item.title !== "string" || !item.title) {
    return `Snapshot item ${item.imdbId} has no title.`;
  }
  return null;
}

function normalizeSnapshotItem(item, index) {
  return {
    imdbId: item.imdbId,
    title: item.title,
    year: Number.isFinite(item.year) ? item.year : null,
    titleType: item.titleType ?? "unknown",
    position: Number.isFinite(item.position) ? item.position : index + 1,
    addedAt: item.addedAt ?? null,
    posterUrl: imdbPosterUrl(item.posterUrl),
  };
}

// The runner is trusted with the secret, not with the shape.
function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.items)) {
    throw new Error("Snapshot missing.");
  }

  const seen = new Set();
  for (const item of snapshot.items) {
    const problem = snapshotItemProblem(item, seen);
    if (problem) {
      throw new Error(problem);
    }
    seen.add(item.imdbId);
  }

  return {
    parserMode: snapshot.parserMode ?? "graphql",
    sourceTitle: snapshot.sourceTitle ?? snapshot.listTitle ?? "",
    listTitle: snapshot.listTitle ?? snapshot.sourceTitle ?? "",
    listAuthor: snapshot.listAuthor ?? "",
    listId: snapshot.listId ?? "",
    lastSourceModifiedAt: snapshot.lastSourceModifiedAt ?? null,
    totalItems: snapshot.items.length,
    items: snapshot.items.map(normalizeSnapshotItem),
  };
}

/** A snapshot item as a feed_items row, the shape everything downstream reads. */
function toStoredItem(item, known) {
  return {
    imdb_id: item.imdbId,
    tvdb_id: known?.tvdbId ?? null,
    tmdb_id: known?.tmdbId ?? null,
    position: item.position,
    title: item.title,
    year: item.year,
    title_type: item.titleType,
    added_at: item.addedAt,
    poster_url: item.posterUrl,
  };
}

function withIds(items, { tvdb = new Map(), tmdb = new Map() }) {
  return items.map((item) => ({
    ...item,
    tvdb_id: tvdb.get(item.imdb_id) ?? item.tvdb_id,
    tmdb_id: tmdb.get(item.imdb_id) ?? item.tmdb_id,
  }));
}

/**
 * Look up what a stored feed still lacks: every show's TVDB id, and the next
 * batch of movies' TMDB ids. They are saved with `fields` in one round trip,
 * and the feed comes back with how many movies are still to look up.
 */
async function resolveStoredIds(env, feed, fields) {
  const [shows, movies] = await Promise.all([
    readUnresolvedSeries(env.DB, feed.id),
    readUnresolvedMovies(env.DB, feed.id, MOVIE_LOOKUPS_PER_REQUEST),
  ]);
  const [tvdb, tmdb] = await Promise.all([resolveTvdbIds(env, shows), resolveTmdbIds(env, movies.imdbIds)]);

  // A show neither source could answer for last time may resolve now; without
  // this it stays out of Sonarr's lists until the list itself changes. Only
  // Sonarr's Custom List body is stored, and only it changes with them.
  if (tvdb.size) {
    const items = withIds(await getFeedItems(env.DB, feed.id), { tvdb });
    fields.sonarr_cache = JSON.stringify(buildSonarrCustomListPayload(items));
    fields.cache_updated_at = nowIso();
  }
  const updated = await updateFeedAndIds(env.DB, feed, fields, { tvdb, tmdb });
  return { ...updated, moviesLeft: movies.total - tmdb.size };
}

/** A read of a list that has not changed since the last one. */
async function syncUnchangedFeed(env, feed, sourceFingerprint) {
  const timestamp = nowIso();
  const fields = {
    source_fingerprint: sourceFingerprint,
    status: "ready",
    last_error: null,
    consecutive_failures: 0,
    refresh_requested_at: null,
    last_synced_at: timestamp,
    updated_at: timestamp,
  };
  return resolveStoredIds(env, feed, fields);
}

/**
 * Store a snapshot. The titles, their TVDB and TMDB ids (carried over from the
 * last read, then looked up for every show and the first batch of movies still
 * without one) and both bodies the feed routes serve are all worked out first
 * and written in one batch.
 */
async function syncFeedFromSnapshot(env, feed, snapshot) {
  const sourceFingerprint = await hashText(buildSnapshotFingerprintPayload(snapshot), 32);
  if (sourceFingerprint === feed.source_fingerprint && feed.cache_updated_at) {
    return syncUnchangedFeed(env, feed, sourceFingerprint);
  }

  const known = await readKnownIds(env.DB, feed.id);
  const stored = snapshot.items.map((item) => toStoredItem(item, known.get(item.imdbId)));
  const shows = filterItemsForTarget(stored, "sonarr").filter((item) => !item.tvdb_id);
  const movies = filterItemsForTarget(stored, "radarr").filter((item) => item.tmdb_id === null);
  const [tvdb, tmdb] = await Promise.all([
    resolveTvdbIds(env, shows.map((item) => item.imdb_id)),
    resolveTmdbIds(env, movies.slice(0, MOVIE_LOOKUPS_PER_REQUEST).map((item) => item.imdb_id)),
  ]);
  const items = withIds(stored, { tvdb, tmdb });

  const timestamp = nowIso();
  const fields = {
    list_title: snapshot.listTitle || snapshot.sourceTitle,
    list_author: snapshot.listAuthor || "",
    list_id: snapshot.listId || "",
    status: "ready",
    item_count: items.length,
    last_error: null,
    consecutive_failures: 0,
    refresh_requested_at: null,
    last_synced_at: timestamp,
    last_source_modified_at: snapshot.lastSourceModifiedAt,
    source_fingerprint: sourceFingerprint,
    cache_updated_at: timestamp,
    updated_at: timestamp,
  };
  const saved = await replaceFeedItems(env.DB, feed, items, {
    ...fields,
    // Built from the feed as it will be once this lands: its RSS names the list and the read's time.
    radarr_cache: buildCachedFeedXmlTemplate({ ...feed, ...fields }, filterItemsForTarget(items, "radarr"), "radarr"),
    sonarr_cache: JSON.stringify(buildSonarrCustomListPayload(items)),
  });
  return { ...saved, moviesLeft: movies.length - tmdb.size };
}

/**
 * Ask the sync job to run now rather than on its next tick, so a pasted list
 * fills in about a minute instead of a quarter of an hour. Best effort on
 * purpose: without GITHUB_DISPATCH_TOKEN the request still sits in the queue
 * and the scheduled run reads it, so a missing, throttled or rejected dispatch
 * must never fail the request it rides on.
 */
async function sendDispatch(env) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${SYNC_WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          "content-type": "application/json",
          "user-agent": "imdbwatcharr-worker",
        },
        body: JSON.stringify({ ref: SYNC_WORKFLOW_REF, inputs: { scope: "requested" } }),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      },
    );

    return response.ok;
  } catch {
    // A network failure or a slow GitHub is the same as no token: the queue
    // still holds the request, so there is nothing to report.
    return false;
  }
}

async function claimSlot(env) {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) {
    return false;
  }
  try {
    return await claimDispatchSlot(env.DB, DISPATCH_INTERVAL_MS);
  } catch {
    return false;
  }
}

/** Ask GitHub for a queue-only run now, at most once a minute. For work already off the visitor's path. */
export async function requestSyncRun(env) {
  return (await claimSlot(env)) && sendDispatch(env);
}

/**
 * The same ask from a paste: the once-a-minute slot is claimed before the
 * page is answered (one D1 write), and the call to GitHub goes out after it,
 * so pressing Generate never waits on GitHub. True when a run was asked for.
 */
export async function requestSyncRunAfterResponse(env, ctx) {
  if (!(await claimSlot(env))) {
    return false;
  }
  ctx.waitUntil(sendDispatch(env));
  return true;
}

async function handleSyncTargetsRoute({ request, env, url }) {
  if (request.method !== "GET" || url.pathname !== "/api/sync-targets") {
    return null;
  }

  if (!isAuthorizedSyncRequest(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  const scope = url.searchParams.get("scope") === "requested" ? "requested" : "all";
  const feeds = await readSyncTargets(env.DB, { scope });

  // What the runner reads: the list, and the two words its log line carries.
  return json({
    feeds: feeds.map((feed) => ({
      sourceUrl: feed.source_url,
      owned: Boolean(feed.owned),
      requested: Boolean(feed.refresh_requested_at),
    })),
  });
}

async function recordReportedFailure(env, payload) {
  const failing = await getFeedByUrl(env.DB, normalizeImdbUrl(payload.sourceUrl).canonicalUrl);
  if (failing) {
    await markFeedFailure(env.DB, failing.id, payload.error, {
      permanent: payload.permanent === true,
      giveUpAfter: FEED_ALERT_FAILURE_THRESHOLD,
    });
  }
  return json({ ok: true, recorded: "error" });
}

async function handleIngestRoute({ request, env, url }) {
  if (request.method !== "POST" || url.pathname !== "/api/ingest") {
    return null;
  }

  if (!isAuthorizedSyncRequest(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = await request.json();

    // A failed fetch on the runner is reported rather than dropped, so the
    // feed shows why it is stale instead of just silently ageing.
    if (payload?.error) {
      return await recordReportedFailure(env, payload);
    }

    const snapshot = validateSnapshot(payload?.snapshot);
    const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
    const existing = await getOrCreateFeed(env.DB, normalized);

    // An empty list is a real answer for a feed that has never had anything,
    // but for one that has, it is far more likely a bad read than a list
    // emptied overnight, and storing it would wipe the feed to zero.
    if (snapshot.items.length === 0 && existing.item_count > 0) {
      throw new Error("IMDb returned an empty list for a feed that had titles, so the last good snapshot was kept.");
    }

    const feed = await syncFeedFromSnapshot(env, existing, snapshot);

    return json({
      ok: true,
      slug: feed.slug,
      status: feed.status,
      itemCount: feed.item_count,
      fingerprint: feed.source_fingerprint,
      moviesLeft: feed.moviesLeft,
    });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
}

/**
 * The next batch of a stored list's TMDB ids (and any show's TVDB id still
 * missing), for a list too big for one request. The runner calls it after an
 * ingest while movies are left and the count keeps falling.
 */
async function handleResolveIdsRoute({ request, env, url }) {
  if (request.method !== "POST" || url.pathname !== "/api/resolve-ids") {
    return null;
  }

  if (!isAuthorizedSyncRequest(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const feed = await getFeedByUrl(env.DB, normalizeImdbUrl(payload?.sourceUrl ?? "").canonicalUrl);
    if (!feed) {
      return json({ error: "No such feed." }, { status: 404 });
    }
    const { moviesLeft } = await resolveStoredIds(env, feed, {});
    return json({ ok: true, moviesLeft });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
}

export const SYNC_ROUTE_HANDLERS = [handleSyncTargetsRoute, handleIngestRoute, handleResolveIdsRoute];
