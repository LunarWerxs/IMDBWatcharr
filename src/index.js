import {
  buildFeedXml,
  buildPublicFeedPath,
  buildSonarrCustomListPayload,
  filterItemsForTarget,
  FEED_ALERT_FAILURE_THRESHOLD,
  injectPublicOrigin,
  isFeedAlerting,
  normalizeImdbUrl,
  parseFeedRoute,
  previewItems,
  skippedShows,
  summarizeItemsByTarget,
} from "./imdb.js";
import { completeLogin, getSession, isAuthConfigured, logout, startLogin } from "./auth.js";
import { json } from "./http.js";
import {
  claimFeed,
  getFeedByUrl,
  getFeedBySlug,
  getFeedItems,
  getOrCreateFeed,
  hasAnyOwner,
  isFeedOwnedBy,
  isStale,
  readAlertingFeeds,
  readOwnedFeeds,
  releaseFeed,
  requestRefresh,
} from "./store.js";
import { requestSyncRun, requestSyncRunAfterResponse, SYNC_ROUTE_HANDLERS } from "./sync.js";
import { handleTitleRoute } from "./tmdb-details.js";

// How often a signed-out visitor may ask for the same list to be re-fetched.
// Their feed does not update on its own, so pasting it again has to do
// something, but not once per click.
const MANUAL_REFRESH_MIN_MS = 1000 * 60 * 5;

// How long the page should wait before asking again while a read is pending:
// a dispatched run lands in about a minute, a queued one on the next scheduled
// run, roughly a quarter of an hour away.
const POLL_AFTER_DISPATCH_SECONDS = 5;
const POLL_AFTER_QUEUE_SECONDS = 30;
const RECENT_DISPATCH_MS = 1000 * 60 * 3;

// Every URL the API hands back is built on the address the request came in on,
// so a local run or a preview hands back links to itself.
function getPublicOrigin(request) {
  return new URL(request.url).origin;
}

// A 301 to PUBLIC_ORIGIN for any other hostname this Worker answers on, keeping
// the path and query so an aliased feed URL still lands on its feed. Only for
// reads: redirecting a POST would drop its body. Local development has no
// PUBLIC_ORIGIN worth enforcing, so it is skipped there.
function canonicalRedirect(request, env, url) {
  if (!env.PUBLIC_ORIGIN || (request.method !== "GET" && request.method !== "HEAD")) {
    return null;
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return null;
  }

  const canonical = new URL(env.PUBLIC_ORIGIN);
  if (url.hostname === canonical.hostname) {
    return null;
  }

  return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
}

// The fingerprint says the list is unchanged, but the served body can still
// change under it (a TVDB id resolved later adds a show to Sonarr), so the
// ETag also carries when the bodies were last written.
function buildFeedEtag(feed, feedTarget) {
  if (!feed?.source_fingerprint) {
    return null;
  }

  const written = feed.cache_updated_at ? `-${Date.parse(feed.cache_updated_at)}` : "";
  return `"${feed.source_fingerprint}-${feedTarget}${written}"`;
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

function describeUnreadFeed(feed, dispatched) {
  if (feed.last_error && !feed.refresh_requested_at) {
    return feed.last_error;
  }

  if (feed.last_error) {
    return `The last try did not work (${feed.last_error}), so the list is back in the queue for the next run.`;
  }

  return dispatched
    ? "We are reading this list from IMDb now. This page updates by itself, usually within a minute."
    : "Your list is in the queue. We read queued lists from IMDb about every five minutes, and this page updates by itself when it lands.";
}

function describeReadyFeed(feed, { dispatched, owned, signedIn }) {
  if (owned) {
    return "Ready, and we are keeping it up to date.";
  }

  if (signedIn) {
    return "Ready. You are not following this list, so it will not update by itself. Paste it again to follow it.";
  }

  if (dispatched) {
    return "Ready. We are refreshing it now.";
  }

  return feed.refresh_requested_at
    ? "Ready, and we will read it again from IMDb within about five minutes."
    : "Ready. Sign in and we will keep it up to date.";
}

// A failed read of a feed that already has titles: the links keep serving the
// last snapshot either way, but only a pending request means we will try again.
function describeStaleFeed(feed) {
  if (feed.refresh_requested_at || !feed.last_error) {
    return "We could not reach IMDb just now, so your links are still serving what we saw last. We will try again on the next run.";
  }

  return `The last read did not work: ${feed.last_error} Your links are still serving what we saw last.`;
}

function describeFeedState(feed, { dispatched, owned, signedIn }) {
  if (feed.status !== "ready" && feed.item_count > 0) {
    return describeStaleFeed(feed);
  }

  if (feed.status !== "ready") {
    return describeUnreadFeed(feed, dispatched);
  }

  return describeReadyFeed(feed, { dispatched, owned, signedIn });
}

/** Where a feed stands, in the shape both /api/create and the status poll return. */
function feedStatusFields(feed, { dispatched = false, owned, signedIn = owned }) {
  return {
    slug: feed.slug,
    listTitle: feed.list_title || "",
    status: feed.status,
    lastSyncedAt: feed.last_synced_at ?? null,
    lastError: feed.last_error ?? null,
    message: describeFeedState(feed, { dispatched, owned, signedIn }),
    // A read is pending, so the page should keep asking; pollAfterSeconds says
    // how often is worth it.
    syncing: dispatched || Boolean(feed.refresh_requested_at),
    pollAfterSeconds: dispatched ? POLL_AFTER_DISPATCH_SECONDS : POLL_AFTER_QUEUE_SECONDS,
    owned,
    autoRefreshing: owned,
  };
}

/** What is on the list, as both /api/create and the status poll report it. */
function feedContents(items) {
  const counts = summarizeItemsByTarget(items);
  const skipped = skippedShows(items);
  return {
    itemCount: counts.radarr,
    radarrCount: counts.radarr,
    sonarrCount: counts.sonarr - skipped.length,
    sonarrUnresolvedCount: skipped.length,
    totalCount: counts.total,
    preview: previewItems(items),
    skippedShows: skipped,
  };
}

// A signed-out visitor gets a first read and a rate-limited re-read each time
// they paste the list again; a signed-in one gets both of those and the
// scheduled sync.
function mayRefreshNow(feed, session) {
  if (feed.status !== "ready" || !feed.last_synced_at) {
    return true;
  }

  if (session) {
    return isStale(feed);
  }

  return Date.now() - Date.parse(feed.last_synced_at) > MANUAL_REFRESH_MIN_MS;
}

// ── Route handlers ──────────────────────────────────────────────────────────
// Each of these returns null when the request is not its own, so `fetch` can
// offer every request to them in turn and answer with the first that claims
// it. They all take the same single context object for that reason, whether or
// not they read every field of it.

async function handleAuthRoutes({ request, env, url }) {
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

  return null;
}

async function handleUnfollowRoute({ request, env, url }) {
  if (request.method !== "POST" || url.pathname !== "/api/unfollow") {
    return null;
  }

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

async function handleCreateRoute({ request, env, ctx, url, publicOrigin }) {
  if (request.method !== "POST" || url.pathname !== "/api/create") {
    return null;
  }

  try {
    const payload = await request.json();
    const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
    const session = await getSession(request, env);
    const feed = await getOrCreateFeed(env.DB, normalized);

    // Nothing here can fetch IMDb, so a feed that needs data is put in the
    // sync job's queue, and the job is asked to run now when it can be. An
    // earlier request keeps its place, and is not dispatched again. TVDB ids
    // are the sync's to find, so this answers from what is stored, and the
    // writes and the read below go out together rather than one after another.
    const queue = mayRefreshNow(feed, session) && !feed.refresh_requested_at;
    const [items, refresh, dispatched] = await Promise.all([
      // Titles only exist once a read has landed.
      feed.last_synced_at ? getFeedItems(env.DB, feed.id) : [],
      queue ? requestRefresh(env.DB, feed) : { feed },
      queue && requestSyncRunAfterResponse(env, ctx),
      // Signing in and pasting a list is what claims it. Claiming is additive,
      // so two people can both keep the same public list alive.
      session && claimFeed(env.DB, feed.id, session.sub),
    ]);

    const radarrPath = buildPublicFeedPath(normalized, "radarr");
    const sonarrPath = buildPublicFeedPath(normalized, "sonarr");
    return json({
      ...feedStatusFields(refresh.feed, { dispatched, owned: Boolean(session), signedIn: Boolean(session) }),
      routePath: radarrPath,
      feedUrl: `${publicOrigin}${radarrPath}`,
      radarrRoutePath: radarrPath,
      radarrFeedUrl: `${publicOrigin}${radarrPath}`,
      sonarrRoutePath: sonarrPath,
      sonarrFeedUrl: `${publicOrigin}${sonarrPath}`,
      ...feedContents(items),
      signedIn: Boolean(session),
    });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
}

async function handleLegacyPathRedirect({ request, url, publicOrigin }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const legacyRedirectPath = getLegacyRedirectPath(url.pathname);
  return legacyRedirectPath ? Response.redirect(`${publicOrigin}${legacyRedirectPath}`, 302) : null;
}

// Radarr and Sonarr poll the feed routes, so a stale OWNED feed is the natural
// place to nudge the sync job. Fire-and-forget: the response is always served
// from what is already stored. An unowned feed is deliberately left alone
// here, which is exactly what signing in changes.
function nudgeSyncForOwnedFeed(feed, env, ctx) {
  ctx.waitUntil(
    hasAnyOwner(env.DB, feed.id)
      .then((owned) => (owned ? requestRefresh(env.DB, feed) : null))
      .then((refresh) => (refresh?.queued ? requestSyncRun(env) : null))
      .catch(() => {
        // The nudge only hurries a sync the schedule runs anyway; a failure to
        // queue it must not surface on a feed poll that has already been served.
      }),
  );
}

const FEED_CONTENT_TYPES = {
  radarr: "application/rss+xml; charset=utf-8",
  sonarr: "application/json; charset=utf-8",
};

// The body a sync stored for this target, or, for a feed read before bodies
// were stored, one built from its titles as they stand.
async function feedBody(env, feed, feedTarget, publicOrigin) {
  if (feedTarget === "sonarr") {
    return feed.sonarr_cache ?? JSON.stringify(buildSonarrCustomListPayload(await getFeedItems(env.DB, feed.id)));
  }

  if (feed.radarr_cache) {
    return injectPublicOrigin(feed.radarr_cache, publicOrigin);
  }

  const movies = filterItemsForTarget(await getFeedItems(env.DB, feed.id), "radarr");
  return buildFeedXml(publicOrigin, feed, movies, "radarr");
}

// A feed that has never been read has nothing to serve. Radarr and Sonarr log
// this body, so it says what is happening rather than just failing.
function notReadYet(feed) {
  const queued = feed.refresh_requested_at
    ? " It is in the queue, and the next sync run (about every five minutes) will read it."
    : "";
  return new Response(`${feed.last_error || "We have not managed to read this list from IMDb yet."}${queued}`, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "900" },
  });
}

async function handleFeedRoute({ request, env, ctx, url, publicOrigin }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const parsedRoute = parseFeedRoute(url.pathname);
  if (!parsedRoute) {
    return null;
  }

  const { feedTarget, canonicalUrl } = parsedRoute;
  const feed = await getFeedByUrl(env.DB, canonicalUrl, feedTarget);

  // Pasting a list on the site is the one way a feed starts. Creating (and
  // queueing a read for) every feed-shaped URL anyone requests would let a
  // crawler fill the queue with IMDb reads nobody asked for.
  if (!feed) {
    return new Response(
      `This IMDb list has not been set up on IMDb Watcharr yet. Paste its IMDb link at ${publicOrigin} to start it.`,
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  if (isStale(feed)) {
    nudgeSyncForOwnedFeed(feed, env, ctx);
  }

  // Only a feed never read might have nothing to serve; every other poll is
  // answered without reading its titles at all.
  if (!feed.last_synced_at && (await getFeedItems(env.DB, feed.id)).length === 0) {
    return notReadYet(feed);
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

  return new Response(await feedBody(env, feed, feedTarget, publicOrigin), {
    headers: { "content-type": FEED_CONTENT_TYPES[feedTarget], ...baseHeaders },
  });
}

async function handleLegacySlugRedirect({ request, env, url, publicOrigin }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const legacyFeedMatch = url.pathname.match(/^\/f\/([a-f0-9]{12})\.xml$/);
  if (!legacyFeedMatch) {
    return null;
  }

  const feed = await getFeedBySlug(env.DB, legacyFeedMatch[1]);
  if (!feed) {
    return new Response("Feed not found.", { status: 404 });
  }

  const redirectUrl = `${publicOrigin}${buildPublicFeedPath(normalizeImdbUrl(feed.source_url), "radarr")}`;
  return Response.redirect(redirectUrl, 302);
}

// Where one feed stands, which is what the page polls while a read is pending.
// Only what the page shows: the stored feed bodies and fingerprints stay in.
async function handleFeedStatusRoute({ request, env, url }) {
  if (request.method !== "GET") {
    return null;
  }

  const statusMatch = url.pathname.match(/^\/api\/feeds\/([a-f0-9]{12})$/);
  if (!statusMatch) {
    return null;
  }

  const feed = await getFeedBySlug(env.DB, statusMatch[1]);
  if (!feed) {
    return json({ error: "Feed not found." }, { status: 404 });
  }

  const session = await getSession(request, env);
  const [owned, items] = await Promise.all([
    isFeedOwnedBy(env.DB, feed.id, session?.sub),
    getFeedItems(env.DB, feed.id),
  ]);

  // A request queued in the last few minutes on a Worker that can dispatch was
  // dispatched (or rides a run that was), so the poll keeps the pace and the
  // words the paste began with instead of dropping to the scheduled ones.
  const dispatched =
    Boolean(env.GITHUB_DISPATCH_TOKEN) &&
    Boolean(feed.refresh_requested_at) &&
    Date.now() - Date.parse(feed.refresh_requested_at) < RECENT_DISPATCH_MS;

  return json({
    ...feedStatusFields(feed, { dispatched, owned, signedIn: Boolean(session) }),
    ...feedContents(items),
  });
}

function handleUnroutedApiPath({ url }) {
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) {
    return null;
  }

  return json({ error: "Not found." }, { status: 404 });
}

async function handleMyFeedsRoute({ request, env, url, publicOrigin }) {
  if (request.method !== "GET" || url.pathname !== "/api/my-feeds") {
    return null;
  }
  const session = await getSession(request, env);
  if (!session) {
    return json({ feeds: [] });
  }
  const feeds = await readOwnedFeeds(env.DB, session.sub);
  return json({
    feeds: feeds.map((feed) => {
      const normalized = normalizeImdbUrl(feed.source_url);
      return {
        slug: feed.slug,
        sourceUrl: feed.source_url,
        listTitle: feed.list_title,
        status: feed.status,
        itemCount: feed.item_count,
        lastSyncedAt: feed.last_synced_at,
        lastError: feed.last_error,
        consecutiveFailures: feed.consecutive_failures,
        // Same threshold the runner's failures accumulate against - see
        // markFeedFailure in src/store.js and FEED_ALERT_FAILURE_THRESHOLD in src/imdb.js.
        alerting: isFeedAlerting(feed.consecutive_failures),
        radarrUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "radarr")}`,
        sonarrUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "sonarr")}`,
      };
    }),
  });
}

// The signed-in visitor's currently-alerting feeds only, so a small header
// badge can show "N feeds need attention" without fetching the whole My
// Feeds list just to compute a count.
async function handleNotificationsRoute({ request, env, url }) {
  if (request.method !== "GET" || url.pathname !== "/api/notifications") {
    return null;
  }
  const session = await getSession(request, env);
  if (!session) {
    return json({ count: 0, feeds: [] });
  }
  const alerting = await readAlertingFeeds(env.DB, session.sub, FEED_ALERT_FAILURE_THRESHOLD);
  const feeds = alerting.map((feed) => ({
    slug: feed.slug,
    listTitle: feed.list_title,
    consecutiveFailures: feed.consecutive_failures,
    lastError: feed.last_error,
  }));
  return json({ count: feeds.length, feeds });
}

// The routing table, in the order the Worker tries them. Every handler takes
// the same request context and returns null when the request is not its own.
const ROUTE_HANDLERS = [
  handleAuthRoutes,
  handleMyFeedsRoute,
  handleNotificationsRoute,
  handleUnfollowRoute,
  ...SYNC_ROUTE_HANDLERS,
  handleCreateRoute,
  // Order matters around the feed routes: an old /p/… or /l/… path is
  // redirected before it can be parsed as a feed route, and a legacy slug is
  // only looked up once the feed routes have declined it.
  handleLegacyPathRedirect,
  handleFeedRoute,
  handleLegacySlugRedirect,
  handleFeedStatusRoute,
  handleTitleRoute,
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One canonical address, so a feed URL copied off the site always reads the
    // same and an alias never becomes a second identity for the same feed.
    const canonical = canonicalRedirect(request, env, url);
    if (canonical) {
      return canonical;
    }

    const requestContext = { request, env, ctx, url, publicOrigin: getPublicOrigin(request) };

    for (const handle of ROUTE_HANDLERS) {
      const response = await handle(requestContext);
      if (response) {
        return response;
      }
    }

    // Anything the API did not claim is the SPA's: this Worker runs first on
    // every request, so the static assets are only reached by falling through.
    const unroutedApi = handleUnroutedApiPath(requestContext);
    if (unroutedApi) {
      return unroutedApi;
    }

    return serveStaticAsset(request, env, url);
  },
};

// Vite names every file under /assets/ after a hash of its contents, so a given
// URL there can never change: it is safe for a browser to keep it for a year and
// never ask again. The asset layer's own default is `max-age=0, must-revalidate`,
// which cost a repeat visitor one conditional request per script, stylesheet and
// font. It is set here rather than in a `_headers` file because this Worker runs
// first on every request and the asset response is the Worker's own response.
// HTML is never marked immutable, even under /assets/: if a hashed file is ever
// missing, the SPA fallback answers with index.html, and a year-long cache of
// that under a script's URL would pin the broken answer in the browser.
const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";

async function serveStaticAsset(request, env, url) {
  const response = await env.ASSETS.fetch(request);
  const html = (response.headers.get("content-type") ?? "").startsWith("text/html");

  // The site is one page, at /. Any other path the asset layer answers with
  // that page is its fallback for a URL that does not exist: the visitor still
  // gets the page, but as a 404, so a search engine does not index every
  // mistyped or made-up URL as another copy of the home page (a soft 404).
  if (html && response.status === 200 && url.pathname !== "/") {
    return new Response(response.body, { status: 404, headers: response.headers });
  }

  const hashed = url.pathname.startsWith("/assets/");
  const cacheable = response.status === 200 || response.status === 304;
  if (!hashed || !cacheable || html) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", IMMUTABLE_ASSET_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
