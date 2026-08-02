import {
  buildFeedXml,
  buildCachedFeedXmlTemplate,
  buildPublicFeedPath,
  buildSonarrCustomListPayload,
  createStableSlug,
  filterItemsForTarget,
  getNormalizedFromStoredFeed,
  hashText,
  injectPublicOrigin,
  normalizeImdbUrl,
  parseFeedRoute,
  summarizeItemsByTarget,
} from "./imdb.js";
import { buildSnapshotFingerprintPayload } from "./imdb-graphql.js";
import { completeLogin, getSession, isAuthConfigured, logout, startLogin } from "./auth.js";

const STALE_AFTER_MS = 1000 * 60 * 60 * 6;

// How often a signed-out visitor may ask for the same list to be re-fetched.
// Their feed does not update on its own, so the button has to do something, but
// not once per click.
const MANUAL_REFRESH_MIN_MS = 1000 * 60 * 5;
const TVMAZE_LOOKUP_CONCURRENCY = 6;
const TVMAZE_HEADERS = {
  accept: "application/json",
  "user-agent": "imdbwatcharr/1.0 (+https://imdbwatcharr.pages.dev)",
};

function json(data, init = {}) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function getPublicOrigin(request) {
  return request.headers.get("x-public-origin") || new URL(request.url).origin;
}

function buildFeedEtag(feed, feedTarget) {
  if (!feed?.source_fingerprint) {
    return null;
  }

  return `"${feed.source_fingerprint}-${feedTarget}"`;
}

function hasFreshEtag(request, etag) {
  if (!etag) {
    return false;
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

function getLegacyRedirectPath(pathname) {
  const directMatch = pathname.match(/^\/(p|l)\/([a-z0-9._-]+)\/?$/i);
  if (directMatch) {
    return `/radarr/${directMatch[1].toLowerCase()}/${directMatch[2]}`;
  }

  const genericMatch = pathname.match(/^\/f\/((?:ls\d+)|(?:p\.[a-z0-9._-]+)|(?:ur[a-z0-9._-]+))\/?$/i);
  if (genericMatch) {
    return `/radarr/f/${genericMatch[1]}`;
  }

  return null;
}

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

// The runner is trusted with the secret, not with the shape. A malformed
// snapshot would otherwise wipe a good feed down to zero items.
function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Snapshot missing.");
  }

  if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    throw new Error("Snapshot has no items.");
  }

  const seen = new Set();
  for (const item of snapshot.items) {
    if (!/^tt\d+$/.test(String(item?.imdbId))) {
      throw new Error(`Snapshot item has a bad IMDb id: ${item?.imdbId}`);
    }
    if (seen.has(item.imdbId)) {
      throw new Error(`Snapshot repeats ${item.imdbId}.`);
    }
    seen.add(item.imdbId);
    if (typeof item.title !== "string" || !item.title) {
      throw new Error(`Snapshot item ${item.imdbId} has no title.`);
    }
  }

  return {
    parserMode: snapshot.parserMode ?? "graphql",
    sourceTitle: snapshot.sourceTitle ?? snapshot.listTitle ?? "",
    listTitle: snapshot.listTitle ?? snapshot.sourceTitle ?? "",
    listAuthor: snapshot.listAuthor ?? "",
    listId: snapshot.listId ?? "",
    lastSourceModifiedAt: snapshot.lastSourceModifiedAt ?? null,
    totalItems: snapshot.items.length,
    items: snapshot.items.map((item, index) => ({
      imdbId: item.imdbId,
      title: item.title,
      year: Number.isFinite(item.year) ? item.year : null,
      titleType: item.titleType ?? "unknown",
      position: Number.isFinite(item.position) ? item.position : index + 1,
      addedAt: item.addedAt ?? null,
    })),
  };
}

function isStale(feed) {
  if (!feed?.last_synced_at) {
    return true;
  }

  return Date.now() - Date.parse(feed.last_synced_at) > STALE_AFTER_MS;
}

async function getFeedBySlug(db, slug) {
  const result = await db.prepare("SELECT * FROM feeds WHERE slug = ?").bind(slug).first();
  return result ?? null;
}

async function getFeedByUrl(db, url) {
  const result = await db.prepare("SELECT * FROM feeds WHERE source_url = ?").bind(url).first();
  return result ?? null;
}

async function getOrCreateFeed(db, normalized) {
  const existing = await getFeedByUrl(db, normalized.canonicalUrl);
  if (existing) {
    return existing;
  }

  return upsertFeed(db, normalized);
}

async function getFeedItems(db, feedId) {
  const result = await db
    .prepare("SELECT imdb_id, tvdb_id, position, title, year, title_type, added_at FROM feed_items WHERE feed_id = ? ORDER BY position ASC")
    .bind(feedId)
    .all();
  return result.results ?? [];
}

async function upsertFeed(db, normalized) {
  const slug = await createStableSlug(normalized.canonicalUrl);
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO feeds (slug, source_url, source_kind, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
    .bind(slug, normalized.canonicalUrl, normalized.sourceKind, timestamp, timestamp)
    .run();
  return getFeedBySlug(db, slug);
}

async function storeFeedSnapshot(db, feed, snapshot) {
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
           last_synced_at = ?, last_source_modified_at = ?, updated_at = ?
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
    last_synced_at: timestamp,
    last_source_modified_at: snapshot.lastSourceModifiedAt,
    updated_at: timestamp,
  };
}

async function storeFeedCaches(db, feed, items, sourceFingerprint) {
  const timestamp = nowIso();
  const radarrItems = filterItemsForTarget(items, "radarr");
  const radarrCache = buildCachedFeedXmlTemplate(feed, radarrItems, "radarr");
  const sonarrCache = JSON.stringify(buildSonarrCustomListPayload(items));

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

async function markFeedFailure(db, feedId, error) {
  const timestamp = nowIso();
  await db
    .prepare("UPDATE feeds SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
    .bind(String(error?.message ?? error), timestamp, feedId)
    .run();
}

async function markFeedUnchanged(db, feed, sourceFingerprint) {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE feeds
       SET source_fingerprint = ?, status = 'ready', last_error = NULL, last_synced_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(sourceFingerprint, timestamp, timestamp, feed.id)
    .run();

  return {
    ...feed,
    source_fingerprint: sourceFingerprint,
    status: "ready",
    last_error: null,
    last_synced_at: timestamp,
    updated_at: timestamp,
  };
}

async function lookupTvdbIdByImdb(imdbId) {
  const response = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, {
    headers: TVMAZE_HEADERS,
    redirect: "follow",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TVMaze lookup failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const tvdbId = Number(payload?.externals?.thetvdb);
  return Number.isInteger(tvdbId) && tvdbId > 0 ? tvdbId : null;
}

async function enrichTvdbIdsForFeed(env, feed, items) {
  const seriesItems = filterItemsForTarget(items, "sonarr").filter((item) => !item.tvdb_id);
  if (!seriesItems.length) {
    return items;
  }

  const resolutions = [];

  // TVMaze is a third party, so keep the lookups bounded rather than firing one
  // request per series at once.
  for (let offset = 0; offset < seriesItems.length; offset += TVMAZE_LOOKUP_CONCURRENCY) {
    const batch = seriesItems.slice(offset, offset + TVMAZE_LOOKUP_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          return { imdbId: item.imdb_id, tvdbId: await lookupTvdbIdByImdb(item.imdb_id) };
        } catch {
          return { imdbId: item.imdb_id, tvdbId: null };
        }
      }),
    );
    resolutions.push(...results.filter((result) => result.tvdbId));
  }

  if (!resolutions.length) {
    return items;
  }

  await env.DB.batch(
    resolutions.map(({ imdbId, tvdbId }) =>
      env.DB.prepare("UPDATE feed_items SET tvdb_id = ? WHERE feed_id = ? AND imdb_id = ?").bind(tvdbId, feed.id, imdbId),
    ),
  );

  return getFeedItems(env.DB, feed.id);
}

async function syncFeedFromSnapshot(env, feed, snapshot) {
  const sourceFingerprint = await hashText(buildSnapshotFingerprintPayload(snapshot), 32);

  if (sourceFingerprint === feed.source_fingerprint && feed.radarr_cache && feed.sonarr_cache) {
    return markFeedUnchanged(env.DB, feed, sourceFingerprint);
  }

  let currentFeed = await storeFeedSnapshot(env.DB, feed, snapshot);
  const storedItems = await getFeedItems(env.DB, currentFeed.id);
  const items = await enrichTvdbIdsForFeed(env, currentFeed, storedItems);
  currentFeed = await storeFeedCaches(env.DB, currentFeed, items, sourceFingerprint);

  return currentFeed;
}

// Asking the sync job to run now, rather than waiting for its next tick. This is
// what keeps a freshly pasted list from sitting empty for a quarter of an hour.
// Best effort on purpose: without a token configured the feed still fills on the
// schedule, so a missing or rejected dispatch must never fail /api/create.
async function requestSyncRun(env, sourceUrl) {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) {
    return false;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "content-type": "application/json",
        "user-agent": "imdbwatcharr-worker",
      },
      body: JSON.stringify({ event_type: "sync-feeds", client_payload: { sourceUrl } }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function describeFeedState(feed, dispatched, owned) {
  if (feed.status !== "ready" && feed.item_count > 0) {
    return "The last refresh did not succeed, so the feeds keep serving the last good snapshot.";
  }

  if (feed.status !== "ready" && feed.last_error) {
    return feed.last_error;
  }

  if (feed.status !== "ready") {
    return dispatched
      ? "Fetching this list from IMDb now. Give it a few seconds, then reload."
      : "Queued. This fills in on the next sync run.";
  }

  if (owned) {
    return "Feed is ready and refreshing automatically.";
  }

  return dispatched
    ? "Feed is ready. Refreshing it now."
    : "Feed is ready. Sign in to keep it refreshing automatically.";
}

async function isFeedOwnedBy(db, feedId, sub) {
  if (!sub) {
    return false;
  }

  const row = await db
    .prepare("SELECT 1 AS owned FROM feed_owners WHERE feed_id = ? AND owner_sub = ?")
    .bind(feedId, sub)
    .first();
  return Boolean(row);
}

async function claimFeed(db, feedId, sub) {
  await db
    .prepare("INSERT OR IGNORE INTO feed_owners (feed_id, owner_sub, created_at) VALUES (?, ?, ?)")
    .bind(feedId, sub, nowIso())
    .run();
}

async function releaseFeed(db, feedId, sub) {
  await db.prepare("DELETE FROM feed_owners WHERE feed_id = ? AND owner_sub = ?").bind(feedId, sub).run();
}

// A signed-out visitor gets one fetch and a rate-limited manual refresh; a
// signed-in one gets both of those and the scheduled sync.
function mayRefreshNow(feed, session) {
  if (feed.status !== "ready" || !feed.last_synced_at) {
    return true;
  }

  if (session) {
    return isStale(feed);
  }

  return Date.now() - Date.parse(feed.last_synced_at) > MANUAL_REFRESH_MIN_MS;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicOrigin = getPublicOrigin(request);

    // ── Sign in with Connections ─────────────────────────────────────────────

    if (request.method === "GET" && url.pathname === "/auth/login") {
      return startLogin(request, env);
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      return completeLogin(request, env);
    }

    if (url.pathname === "/auth/logout") {
      return logout();
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const session = await getSession(request, env);
      return json({
        signedIn: Boolean(session),
        name: session?.name ?? null,
        authAvailable: isAuthConfigured(env),
      });
    }

    // The feeds a signed-in visitor has claimed, which is what the account is
    // for, so it is worth showing them plainly.
    if (request.method === "GET" && url.pathname === "/api/my-feeds") {
      const session = await getSession(request, env);
      if (!session) {
        return json({ feeds: [] });
      }

      const result = await env.DB.prepare(
        `SELECT f.slug, f.source_url, f.source_kind, f.list_title, f.status, f.item_count, f.last_synced_at
           FROM feeds f JOIN feed_owners o ON o.feed_id = f.id
          WHERE o.owner_sub = ?
          ORDER BY f.list_title`,
      )
        .bind(session.sub)
        .all();

      return json({
        feeds: (result.results ?? []).map((feed) => ({
          slug: feed.slug,
          sourceUrl: feed.source_url,
          listTitle: feed.list_title,
          status: feed.status,
          itemCount: feed.item_count,
          lastSyncedAt: feed.last_synced_at,
          radarrUrl: `${publicOrigin}${buildPublicFeedPath(normalizeImdbUrl(feed.source_url), "radarr")}`,
          sonarrUrl: `${publicOrigin}${buildPublicFeedPath(normalizeImdbUrl(feed.source_url), "sonarr")}`,
        })),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/unfollow") {
      const session = await getSession(request, env);
      if (!session) {
        return json({ error: "Sign in first." }, { status: 401 });
      }

      try {
        const payload = await request.json();
        const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
        const feed = await getFeedByUrl(env.DB, normalized.canonicalUrl);
        if (feed) {
          await releaseFeed(env.DB, feed.id, session.sub);
        }
        return json({ ok: true });
      } catch (error) {
        return json({ error: error.message }, { status: 400 });
      }
    }

    // ── The sync job's two routes ────────────────────────────────────────────
    // IMDb refuses every request from Cloudflare's egress, so the Worker cannot
    // fetch its own data. A GitHub Actions run does the fetching and hands the
    // result back through here. Both routes are shared-secret authenticated.

    if (request.method === "GET" && url.pathname === "/api/sync-targets") {
      if (!isAuthorizedSyncRequest(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      // Only claimed feeds ride the schedule. An unowned feed keeps serving what
      // it already has and is refetched only when someone asks for it.
      const result = await env.DB.prepare(
        `SELECT f.source_url, f.source_kind, f.status, f.last_synced_at, f.source_fingerprint
           FROM feeds f
          WHERE EXISTS (SELECT 1 FROM feed_owners o WHERE o.feed_id = f.id)
          ORDER BY f.last_synced_at IS NULL DESC, f.last_synced_at ASC`,
      ).all();

      return json({
        feeds: (result.results ?? []).map((feed) => ({
          sourceUrl: feed.source_url,
          sourceKind: feed.source_kind,
          status: feed.status,
          lastSyncedAt: feed.last_synced_at,
          fingerprint: feed.source_fingerprint,
          stale: isStale(feed),
        })),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/ingest") {
      if (!isAuthorizedSyncRequest(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      try {
        const payload = await request.json();

        // A failed fetch on the runner is reported rather than dropped, so the
        // feed shows why it is stale instead of just silently ageing.
        if (payload?.error) {
          const failing = await getFeedByUrl(env.DB, normalizeImdbUrl(payload.sourceUrl).canonicalUrl);
          if (failing) {
            await markFeedFailure(env.DB, failing.id, payload.error);
          }
          return json({ ok: true, recorded: "error" });
        }

        const snapshot = validateSnapshot(payload?.snapshot);
        const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
        const existing = await getOrCreateFeed(env.DB, normalized);
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

    if (request.method === "POST" && url.pathname === "/api/create") {
      try {
        const payload = await request.json();
        const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
        const session = await getSession(request, env);
        let feed = await getOrCreateFeed(env.DB, normalized);

        // Signing in and pasting a list is what claims it. Claiming is additive,
        // so two people can both keep the same public list alive.
        if (session) {
          await claimFeed(env.DB, feed.id, session.sub);
        }

        // Nothing here can fetch IMDb, so a feed that needs data asks the sync
        // job to run and reports honestly in the meantime.
        let dispatched = false;
        if (mayRefreshNow(feed, session)) {
          dispatched = await requestSyncRun(env, normalized.canonicalUrl);
        }

        const message = describeFeedState(feed, dispatched, Boolean(session));
        const storedItems = await getFeedItems(env.DB, feed.id);
        const enrichedItems = await enrichTvdbIdsForFeed(env, feed, storedItems);
        const counts = summarizeItemsByTarget(enrichedItems);
        const sonarrPayload = buildSonarrCustomListPayload(enrichedItems);
        const sonarrUnresolvedCount = counts.sonarr - sonarrPayload.length;

        // The cached payloads are only built during a sync, so a TVDB id resolved
        // outside one leaves the served feed behind what this response reports.
        // Compare against the cache itself rather than against what this request
        // happened to resolve, or a feed enriched by an earlier request stays stale.
        if (feed.source_fingerprint && feed.sonarr_cache !== JSON.stringify(sonarrPayload)) {
          feed = await storeFeedCaches(env.DB, feed, enrichedItems, feed.source_fingerprint);
        }

        return json({
          slug: feed.slug,
          listTitle: feed.list_title || "",
          routePath: buildPublicFeedPath(normalized, "radarr"),
          feedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "radarr")}`,
          radarrRoutePath: buildPublicFeedPath(normalized, "radarr"),
          radarrFeedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "radarr")}`,
          sonarrRoutePath: buildPublicFeedPath(normalized, "sonarr"),
          sonarrFeedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "sonarr")}`,
          status: feed.status,
          itemCount: counts.radarr,
          radarrCount: counts.radarr,
          sonarrCount: sonarrPayload.length,
          sonarrUnresolvedCount,
          totalCount: counts.total,
          message,
          syncing: dispatched || feed.status === "syncing",
          owned: Boolean(session),
          signedIn: Boolean(session),
          autoRefreshing: Boolean(session),
        });
      } catch (error) {
        return json({ error: error.message }, { status: 400 });
      }
    }

    const legacyRedirectPath = getLegacyRedirectPath(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && legacyRedirectPath) {
      return Response.redirect(`${publicOrigin}${legacyRedirectPath}`, 302);
    }

    const parsedRoute = parseFeedRoute(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && parsedRoute) {
      const { feedTarget, ...normalizedRoute } = parsedRoute;
      let feed = await getOrCreateFeed(env.DB, normalizedRoute);

      // Radarr and Sonarr poll these routes, so a stale OWNED feed is the natural
      // place to nudge the sync job. Fire-and-forget: the response is always
      // served from what is already stored. An unowned feed is deliberately left
      // alone here, which is exactly what signing in changes.
      if (isStale(feed)) {
        ctx.waitUntil(
          env.DB.prepare("SELECT 1 AS owned FROM feed_owners WHERE feed_id = ? LIMIT 1")
            .bind(feed.id)
            .first()
            .then((owned) => (owned ? requestSyncRun(env, feed.source_url) : null))
            .catch(() => {}),
        );
      }

      const items = await getFeedItems(env.DB, feed.id);
      if (items.length === 0) {
        return new Response(feed.last_error || "Feed exists but has not synced successfully yet.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      const etag = buildFeedEtag(feed, feedTarget);
      const baseHeaders = {
        "cache-control": "public, max-age=300",
        ...(etag ? { etag } : {}),
      };

      if (hasFreshEtag(request, etag)) {
        return new Response(null, {
          status: 304,
          headers: baseHeaders,
        });
      }

      if (feedTarget === "sonarr") {
        if (feed.sonarr_cache) {
          return new Response(feed.sonarr_cache, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              ...baseHeaders,
            },
          });
        }

        const enrichedItems = await enrichTvdbIdsForFeed(env, feed, items);
        const payload = buildSonarrCustomListPayload(enrichedItems);
        return json(payload, {
          headers: {
            ...baseHeaders,
          },
        });
      }

      if (feed.radarr_cache) {
        return new Response(injectPublicOrigin(feed.radarr_cache, publicOrigin), {
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            ...baseHeaders,
          },
        });
      }

      const filteredItems = filterItemsForTarget(items, feedTarget);
      const xml = buildFeedXml(publicOrigin, feed, filteredItems, feedTarget);
      return new Response(xml, {
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
          ...baseHeaders,
        },
      });
    }

    const legacyFeedMatch = url.pathname.match(/^\/f\/([a-f0-9]{12})\.xml$/);
    if ((request.method === "GET" || request.method === "HEAD") && legacyFeedMatch) {
      const feed = await getFeedBySlug(env.DB, legacyFeedMatch[1]);
      if (!feed) {
        return new Response("Feed not found.", { status: 404 });
      }

      const redirectUrl = `${publicOrigin}${buildPublicFeedPath(getNormalizedFromStoredFeed(feed), "radarr")}`;
      return Response.redirect(redirectUrl, 302);
    }

    const metadataMatch = url.pathname.match(/^\/api\/feeds\/([a-f0-9]{12})$/);
    if (request.method === "GET" && metadataMatch) {
      const feed = await getFeedBySlug(env.DB, metadataMatch[1]);
      if (!feed) {
        return json({ error: "Feed not found." }, { status: 404 });
      }
      return json(feed);
    }

    // Anything the API did not claim is the SPA's: this Worker runs first on
    // every request, so the static assets are only reached by falling through.
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      return json({ error: "Not found." }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
