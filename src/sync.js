// The sync job's half of the Worker.
//
// IMDb refuses every request from Cloudflare's egress, so the Worker cannot
// fetch its own data. A GitHub Actions run (scripts/sync-feeds.mjs) asks
// /api/sync-targets what to read, reads it from IMDb, and hands each result
// back through /api/ingest. Both routes are shared-secret authenticated.
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
  isStale,
  markFeedFailure,
  markFeedUnchanged,
  readSyncTargets,
  storeFeedCaches,
  storeFeedSnapshot,
} from "./store.js";
import { enrichTvdbIdsForFeed, resolveMissingTvdbIds } from "./tvdb.js";

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

/** Rebuild the two bodies the feed routes serve, from the items as stored. */
export async function writeFeedCaches(db, feed, items, sourceFingerprint) {
  return storeFeedCaches(db, feed, {
    radarrCache: buildCachedFeedXmlTemplate(feed, filterItemsForTarget(items, "radarr"), "radarr"),
    sonarrCache: JSON.stringify(buildSonarrCustomListPayload(items)),
    sourceFingerprint,
  });
}

async function syncFeedFromSnapshot(env, feed, snapshot) {
  const sourceFingerprint = await hashText(buildSnapshotFingerprintPayload(snapshot), 32);

  if (sourceFingerprint === feed.source_fingerprint && feed.radarr_cache && feed.sonarr_cache) {
    // The list did not change, but a series TVMaze could not answer for last
    // time may resolve now; without this it stays out of Sonarr until the
    // list itself changes.
    const { items, resolvedCount } = await resolveMissingTvdbIds(env, feed, await getFeedItems(env.DB, feed.id));
    const current = resolvedCount ? await writeFeedCaches(env.DB, feed, items, sourceFingerprint) : feed;
    return markFeedUnchanged(env.DB, current, sourceFingerprint);
  }

  const currentFeed = await storeFeedSnapshot(env.DB, feed, snapshot);
  const storedItems = await getFeedItems(env.DB, currentFeed.id);
  const items = await enrichTvdbIdsForFeed(env, currentFeed, storedItems);
  return writeFeedCaches(env.DB, currentFeed, items, sourceFingerprint);
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

  return json({
    feeds: feeds.map((feed) => ({
      sourceUrl: feed.source_url,
      sourceKind: feed.source_kind,
      status: feed.status,
      lastSyncedAt: feed.last_synced_at,
      fingerprint: feed.source_fingerprint,
      stale: isStale(feed),
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
    });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
}

export const SYNC_ROUTE_HANDLERS = [handleSyncTargetsRoute, handleIngestRoute];
