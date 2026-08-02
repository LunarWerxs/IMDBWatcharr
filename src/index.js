import { launch } from "@cloudflare/playwright";
import {
  buildFeedXml,
  buildCachedFeedXmlTemplate,
  buildPublicFeedPath,
  buildSonarrCustomListPayload,
  createStableSlug,
  extractImdbFingerprintPayload,
  filterItemsForTarget,
  getNormalizedFromStoredFeed,
  hashText,
  injectPublicOrigin,
  normalizeImdbUrl,
  parseFeedRoute,
  parseImdbHtml,
  summarizeItemsByTarget,
} from "./imdb.js";

const STALE_AFTER_MS = 1000 * 60 * 60 * 6;
const BROWSER_ATTEMPTS = 3;
const TVMAZE_LOOKUP_CONCURRENCY = 6;
const DIRECT_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchImdbHtmlDirect(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: DIRECT_FETCH_HEADERS,
    redirect: "follow",
  });

  // A challenge or block page is not list data. Fail here so the caller moves
  // on to Browser Rendering instead of parsing an error page.
  if (!response.ok) {
    throw new Error(`IMDb direct fetch failed with status ${response.status}.`);
  }

  return response.text();
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

async function syncFeedFromHtml(env, feed, htmlText) {
  const sourceFingerprint = await hashText(extractImdbFingerprintPayload(htmlText), 32);

  if (sourceFingerprint === feed.source_fingerprint && feed.radarr_cache && feed.sonarr_cache) {
    return markFeedUnchanged(env.DB, feed, sourceFingerprint);
  }

  const parsed = parseImdbHtml(htmlText);
  let currentFeed = await storeFeedSnapshot(env.DB, feed, parsed);
  const storedItems = await getFeedItems(env.DB, currentFeed.id);
  const items = await enrichTvdbIdsForFeed(env, currentFeed, storedItems);
  currentFeed = await storeFeedCaches(env.DB, currentFeed, items, sourceFingerprint);

  return currentFeed;
}

async function syncFeed(env, feed) {
  await env.DB.prepare("UPDATE feeds SET status = 'syncing', updated_at = ? WHERE id = ?").bind(nowIso(), feed.id).run();

  try {
    const htmlText = await fetchImdbHtmlDirect(feed.source_url);
    return await syncFeedFromHtml(env, feed, htmlText);
  } catch {}

  let lastError = null;
  for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt += 1) {
    let browser;
    try {
      browser = await launch(env.BROWSER);
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1440, height: 1800 });

      try {
        await page.goto(feed.source_url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch {
        // IMDb may still complete after the initial timeout, so keep inspecting the page.
      }

      await page.waitForTimeout(3000);
      const htmlText = await page.content();
      await browser.close();
      return await syncFeedFromHtml(env, feed, htmlText);
    } catch (error) {
      lastError = error;
      try {
        await browser.close();
      } catch {}
      if (!/429|rate limit/i.test(String(error)) || attempt === BROWSER_ATTEMPTS) {
        break;
      }
      await sleep(attempt * 2000);
    }
  }

  await markFeedFailure(env.DB, feed.id, lastError);
  throw lastError;
}

async function ensureFeedIsFresh(env, feed) {
  if (feed.status === "syncing") {
    return { feed, message: "Feed is already syncing. Using the latest stored snapshot for now." };
  }

  const shouldSync = feed.status !== "ready" || isStale(feed);
  let currentFeed = feed;
  let message = "Feed is ready.";

  if (shouldSync) {
    try {
      currentFeed = await syncFeed(env, feed);
    } catch (error) {
      message = error.message;
      currentFeed = await getFeedByUrl(env.DB, feed.source_url);
    }
  }

  return { feed: currentFeed, message };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicOrigin = getPublicOrigin(request);

    // The UI is the SPA served by Cloudflare Pages; the Worker is API only.
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return json({
        service: "imdbwatcharr",
        ui: "https://imdbwatcharr.pages.dev",
        routes: ["POST /api/create", "GET /radarr/{p|l|f}/:id", "GET /sonarr/{p|l|f}/:id"],
      });
    }

    if (request.method === "POST" && url.pathname === "/api/create") {
      try {
        const payload = await request.json();
        const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
        const existing = await getOrCreateFeed(env.DB, normalized);
        let { feed, message } = await ensureFeedIsFresh(env, existing);
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

      if (feed.status !== "ready") {
        const result = await ensureFeedIsFresh(env, feed);
        feed = result.feed;
      } else if (isStale(feed) && feed.status !== "syncing") {
        ctx.waitUntil(syncFeed(env, feed).catch(() => {}));
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

    return new Response("Not found.", { status: 404 });
  },
};
