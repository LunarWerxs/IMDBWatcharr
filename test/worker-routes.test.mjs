// WHY: src/index.js's fetch handler is the whole Worker - every route, every
// status code, every response shape the API hands back - and until now the
// only thing the gate ever checked about it was that it is a function (see
// smoke.test.mjs). The Architect's complexity findings on that function are
// only safe to act on if something pins what it does today, so this file
// characterises it: a stub D1 answers each prepared statement from a rule
// table, a stub ASSETS binding stands in for the SPA, and each test asserts
// the status, body and (where it matters) the dispatch order that the route
// produced.
//
// What this does NOT cover: D1's own SQL semantics and the live OAuth/TVMaze
// HTTP calls. The stub answers a prepared statement, it does not run it, so a
// wrong query still passes here.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ORIGIN,
  SESSION_SECRET,
  CANONICAL_LIST,
  makeDb,
  makeEnv,
  makeCtx,
  sessionCookie,
  call,
  RECENT,
  feedRow,
  MOVIE_ITEM,
  SERIES_ITEM,
} from "./support/worker-harness.mjs";

describe("fetch - canonical host", () => {
  test("a GET on an alias hostname 301s to PUBLIC_ORIGIN, keeping path and query", async () => {
    const { env } = makeEnv({ PUBLIC_ORIGIN: ORIGIN });
    const { response } = await call("https://alias.example/l/ls006123300?x=1", { env });

    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), `${ORIGIN}/l/ls006123300?x=1`);
  });

  test("a POST on an alias hostname is not redirected, so its body survives", async () => {
    const { env } = makeEnv({ PUBLIC_ORIGIN: ORIGIN });
    const { response, parsed } = await call("https://alias.example/api/me", {
      method: "POST",
      env,
    });

    assert.equal(response.status, 404);
    assert.deepEqual(parsed, { error: "Not found." });
  });

  test("localhost is exempt, so local development is not forced onto PUBLIC_ORIGIN", async () => {
    const { env } = makeEnv({ PUBLIC_ORIGIN: ORIGIN });
    const { response, parsed } = await call("http://localhost:8787/api/me", { env });

    assert.equal(response.status, 200);
    assert.equal(parsed.signedIn, false);
  });
});

describe("fetch - auth and session routes", () => {
  test("GET /auth/logout clears the session and redirects home", async () => {
    const { env } = makeEnv();
    const { response } = await call(`${ORIGIN}/auth/logout`, { env });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.match(response.headers.get("set-cookie"), /^iw_session=;/);
  });

  test("GET /api/me signed out reports no session and whether sign-in is configured", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/me`, { env });

    assert.equal(response.status, 200);
    assert.deepEqual(parsed, { signedIn: false, name: null, authAvailable: false });
  });

  test("a malformed session cookie reads as signed out, not as a server error", async () => {
    const { env } = makeEnv({ SESSION_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/me`, {
      env,
      headers: { cookie: "iw_session=not-base64!.%%%" },
    });

    assert.equal(response.status, 200);
    assert.equal(parsed.signedIn, false);
  });

  test("GET /api/me signed in echoes the name and sees the configured client", async () => {
    const { env } = makeEnv({
      SESSION_SECRET,
      CONNECTIONS_CLIENT_ID: "client",
      CONNECTIONS_CLIENT_SECRET: "secret",
    });
    const { parsed } = await call(`${ORIGIN}/api/me`, {
      env,
      headers: { cookie: await sessionCookie("user-1", "Ada") },
    });

    assert.deepEqual(parsed, { signedIn: true, name: "Ada", authAvailable: true });
  });

  test("GET /auth/login only ever returns to a path on this site, never another host", async () => {
    const { env } = makeEnv({
      SESSION_SECRET,
      CONNECTIONS_CLIENT_ID: "client",
      CONNECTIONS_CLIENT_SECRET: "secret",
    });
    // The return path rides in the signed state cookie's readable body.
    const returnToOf = async (returnTo) => {
      const { response } = await call(`${ORIGIN}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { env });
      assert.equal(response.status, 302);
      const body = response.headers.get("set-cookie").match(/^iw_oauth_state=([^.]+)\./)[1];
      return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))).returnTo;
    };

    assert.equal(await returnToOf("//evil.example/steal"), "/");
    assert.equal(await returnToOf("/\\evil.example"), "/");
    assert.equal(await returnToOf("https://evil.example/"), "/");
    assert.equal(await returnToOf("/\t/evil.example"), "/", "browsers strip the tab and read //evil.example");
    assert.equal(await returnToOf("/?list=https%3A%2F%2Fwww.imdb.com%2Flist%2Fls006123300%2F"), "/?list=https%3A%2F%2Fwww.imdb.com%2Flist%2Fls006123300%2F");
  });

  test("GET /auth/login without a configured client answers 503 rather than a broken redirect", async () => {
    const { env } = makeEnv();
    const { response, text } = await call(`${ORIGIN}/auth/login`, { env });

    assert.equal(response.status, 503);
    assert.equal(text, "Sign in is not configured.");
  });

  test("a sign-in started in the popup window ends on a page that tells the site and closes, session set", async () => {
    const { env } = makeEnv({
      SESSION_SECRET,
      CONNECTIONS_CLIENT_ID: "client",
      CONNECTIONS_CLIENT_SECRET: "secret",
    });
    const returnTo = "/?list=https%3A%2F%2Fwww.imdb.com%2Flist%2Fls006123300%2F";
    const login = await call(`${ORIGIN}/auth/login?popup=1&returnTo=${encodeURIComponent(returnTo)}`, { env });
    const stateCookie = login.response.headers.get("set-cookie").split(";")[0];
    const state = new URL(login.response.headers.get("location")).searchParams.get("state");

    // The token exchange and userinfo are the identity provider's side of the
    // boundary; everything this app does with their answers runs for real.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth/token")) return Response.json({ access_token: "token" });
      if (url.endsWith("/oauth/userinfo")) return Response.json({ sub: "user-1", name: "Ada" });
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const { response, text } = await call(`${ORIGIN}/auth/callback?code=c&state=${state}`, {
        env,
        headers: { cookie: stateCookie },
      });

      assert.equal(response.status, 200, "the window gets a closing page, not the whole site");
      assert.equal(response.headers.get("location"), null);
      assert.match(response.headers.get("set-cookie"), /iw_session=[^;]+\./);
      assert.match(text, /new BroadcastChannel\("watcharr-auth"\)/);
      assert.ok(text.includes(`location.replace(${JSON.stringify(returnTo)})`), "falls back to the list it came from");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("fetch - /api/my-feeds", () => {
  test("signed out it returns an empty list without touching the database", async () => {
    const DB = makeDb();
    const { env } = makeEnv({ DB });
    const { parsed } = await call(`${ORIGIN}/api/my-feeds`, { env });

    assert.deepEqual(parsed, { feeds: [] });
    assert.equal(DB.calls.length, 0);
  });

  test("signed in it projects each owned feed with both public URLs and the alerting flag", async () => {
    const DB = makeDb([
      [
        "FROM feeds f JOIN feed_owners o",
        {
          results: [
            {
              slug: "abcdef012345",
              source_url: CANONICAL_LIST,
              source_kind: "list",
              list_title: "My List",
              status: "error",
              item_count: 2,
              last_synced_at: RECENT,
              last_error: "IMDb said no.",
              consecutive_failures: 3,
            },
          ],
        },
      ],
    ]);
    const { env } = makeEnv({ DB, SESSION_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/my-feeds`, {
      env,
      headers: { cookie: await sessionCookie("user-1") },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(parsed.feeds, [
      {
        slug: "abcdef012345",
        sourceUrl: CANONICAL_LIST,
        listTitle: "My List",
        status: "error",
        itemCount: 2,
        lastSyncedAt: RECENT,
        lastError: "IMDb said no.",
        consecutiveFailures: 3,
        alerting: true,
        radarrUrl: `${ORIGIN}/radarr/l/ls006123300`,
        sonarrUrl: `${ORIGIN}/sonarr/l/ls006123300`,
      },
    ]);
  });

  test("a POST to the path is not claimed, and falls through to the API 404", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/my-feeds`, { method: "POST", env });

    assert.equal(response.status, 404);
    assert.deepEqual(parsed, { error: "Not found." });
  });
});

describe("fetch - /api/notifications", () => {
  test("signed out it reports nothing to show", async () => {
    const { env } = makeEnv();
    const { parsed } = await call(`${ORIGIN}/api/notifications`, { env });

    assert.deepEqual(parsed, { count: 0, feeds: [] });
  });

  test("signed in it counts the alerting feeds and keeps the failure detail", async () => {
    const DB = makeDb([
      [
        "consecutive_failures >= ?",
        {
          results: [
            { slug: "abcdef012345", list_title: "My List", consecutive_failures: 4, last_error: "IMDb said no." },
          ],
        },
      ],
    ]);
    const { env } = makeEnv({ DB, SESSION_SECRET });
    const { parsed } = await call(`${ORIGIN}/api/notifications`, {
      env,
      headers: { cookie: await sessionCookie("user-1") },
    });

    assert.deepEqual(parsed, {
      count: 1,
      feeds: [
        { slug: "abcdef012345", listTitle: "My List", consecutiveFailures: 4, lastError: "IMDb said no." },
      ],
    });
    // The threshold it filters on is the shared alerting constant, not a literal.
    const [query] = DB.find("consecutive_failures >= ?");
    assert.deepEqual(query.args, ["user-1", 3]);
  });
});

describe("fetch - /api/unfollow", () => {
  test("signed out it refuses with 401", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/unfollow`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST },
      env,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(parsed, { error: "Sign in first." });
  });

  test("signed in it releases the feed the caller owned and answers ok", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["DELETE FROM feed_owners", { success: true }],
    ]);
    const { env } = makeEnv({ DB, SESSION_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/unfollow`, {
      method: "POST",
      body: { sourceUrl: "https://www.imdb.com/list/ls006123300/?ref_=x" },
      env,
      headers: { cookie: await sessionCookie("user-1") },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(parsed, { ok: true });
    const [release] = DB.find("DELETE FROM feed_owners");
    assert.deepEqual(release.args, [7, "user-1"]);
  });

  test("signed in but with an unusable link it answers 400 with the normaliser's message", async () => {
    const { env } = makeEnv({ SESSION_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/unfollow`, {
      method: "POST",
      body: { sourceUrl: "https://example.com/not-imdb" },
      env,
      headers: { cookie: await sessionCookie("user-1") },
    });

    assert.equal(response.status, 400);
    assert.equal(parsed.error, "That link is not a public IMDb list or watchlist. Check it and try again.");
  });
});

describe("fetch - /api/create", () => {
  const CREATE_ROW = feedRow({ status: "pending", item_count: 0, last_synced_at: null });

  test("a bad link is a 400 with the normaliser's message", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/create`, {
      method: "POST",
      body: { sourceUrl: "https://example.com/not-imdb" },
      env,
    });

    assert.equal(response.status, 400);
    assert.equal(parsed.error, "That link is not a public IMDb list or watchlist. Check it and try again.");
  });

  test("a new signed-out list reports both routes and honest pending state", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", CREATE_ROW],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response, parsed } = await call(`${ORIGIN}/api/create`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST },
      env,
    });

    assert.equal(response.status, 200);
    assert.equal(
      DB.find("SET refresh_requested_at = COALESCE").length,
      1,
      "a signed-out paste must queue the list's first read, or nothing ever reads it",
    );
    assert.deepEqual(parsed, {
      slug: "abcdef012345",
      listTitle: "My List",
      lastSyncedAt: null,
      lastError: null,
      pollAfterSeconds: 30,
      routePath: "/radarr/l/ls006123300",
      feedUrl: `${ORIGIN}/radarr/l/ls006123300`,
      radarrRoutePath: "/radarr/l/ls006123300",
      radarrFeedUrl: `${ORIGIN}/radarr/l/ls006123300`,
      sonarrRoutePath: "/sonarr/l/ls006123300",
      sonarrFeedUrl: `${ORIGIN}/sonarr/l/ls006123300`,
      status: "pending",
      itemCount: 0,
      radarrCount: 0,
      sonarrCount: 0,
      sonarrUnresolvedCount: 0,
      totalCount: 0,
      preview: [],
      skippedShows: [],
      message:
        "Your list is in the queue. We read queued lists from IMDb about every five minutes, and this page updates by itself when it lands.",
      // No dispatch token, but the read is queued, so the page keeps polling
      // at the queue's pace until it lands.
      syncing: true,
      owned: false,
      signedIn: false,
      autoRefreshing: false,
    });
  });

  test("a list already in the queue does not ask GitHub again, however often it is pasted", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", { ...CREATE_ROW, refresh_requested_at: RECENT }],
      ["FROM feed_items", { results: [] }],
      ["UPDATE sync_dispatch", { meta: { changes: 1 } }],
    ]);
    const { env } = makeEnv({ DB, GITHUB_DISPATCH_TOKEN: "token", GITHUB_REPOSITORY: "owner/repo" });
    const dispatches = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      dispatches.push(String(url));
      return new Response(null, { status: 204 });
    };
    try {
      const { parsed } = await call(`${ORIGIN}/api/create`, { method: "POST", body: { sourceUrl: CANONICAL_LIST }, env });
      assert.equal(parsed.syncing, true, "it is still waiting in the queue");
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.deepEqual(dispatches, []);
  });

  test("signed in, an up-to-date feed says it is being kept current and claims it", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB, SESSION_SECRET });
    const { parsed } = await call(`${ORIGIN}/api/create`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST },
      env,
      headers: { cookie: await sessionCookie("user-1") },
    });

    assert.equal(parsed.message, "Ready, and we are keeping it up to date.");
    assert.equal(parsed.owned, true);
    assert.equal(parsed.syncing, false, "a freshly synced feed is not reported as syncing");
    assert.equal(DB.find("INSERT OR IGNORE INTO feed_owners").length, 1);
  });

  test("the origin every URL is built from is the caller's, not a constant", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB });
    const { parsed } = await call("https://preview.example/api/create", {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST },
      env,
    });

    assert.equal(parsed.feedUrl, "https://preview.example/radarr/l/ls006123300");
  });
});

describe("fetch - feed routes", () => {
  test("a stale owned feed is nudged through ctx.waitUntil without delaying the response", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ last_synced_at: null })],
      ["SELECT 1 AS owned FROM feed_owners", { owned: 1 }],
      ["FROM feed_items", { results: [MOVIE_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const ctx = makeCtx();
    const { response } = await call(`${ORIGIN}/radarr/l/ls006123300`, { env, ctx });

    assert.equal(response.status, 200);
    assert.equal(ctx.waited.length, 1);
    await Promise.all(ctx.waited);
  });

  test("a feed URL nobody has pasted is a 404 that says how to start it, and creates nothing", async () => {
    const DB = makeDb([["SELECT * FROM feeds WHERE source_url = ?", null]]);
    const { env } = makeEnv({ DB });
    const { response, text } = await call(`${ORIGIN}/radarr/l/ls000000077`, { env });

    assert.equal(response.status, 404);
    assert.match(text, /Paste its IMDb link at/);
    assert.equal(DB.find("INSERT INTO feeds").length, 0, "a crawler must not be able to fill the read queue");
  });

  test("an empty feed answers 503 with the last error, so Radarr sees a reason", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ last_synced_at: null, last_error: "IMDb said no." })],
      ["SELECT 1 AS owned FROM feed_owners", null],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response, text } = await call(`${ORIGIN}/radarr/l/ls006123300`, { env });

    assert.equal(response.status, 503);
    assert.equal(text, "IMDb said no.");
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  test("an empty feed with no recorded error still says something readable", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ last_synced_at: null, last_error: null })],
      ["SELECT 1 AS owned FROM feed_owners", null],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB });
    const { text } = await call(`${ORIGIN}/radarr/l/ls006123300`, { env });

    assert.equal(text, "We have not managed to read this list from IMDb yet.");
  });

  test("a matching If-None-Match short-circuits to 304 with the cache headers", async () => {
    const etag = `"${"a".repeat(32)}-radarr"`;
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ source_fingerprint: "a".repeat(32) })],
      ["FROM feed_items", { results: [MOVIE_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response } = await call(`${ORIGIN}/radarr/l/ls006123300`, {
      env,
      headers: { "if-none-match": etag },
    });

    assert.equal(response.status, 304);
    assert.equal(response.headers.get("etag"), etag);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.equal(await response.text(), "");
  });

  test("radarr with a cache serves the stored XML and rewrites the origin placeholder", async () => {
    const DB = makeDb([
      [
        "SELECT * FROM feeds WHERE source_url = ?",
        feedRow({
          source_fingerprint: "a".repeat(32),
          radarr_cache: `<rss><channel><link>https://www.imdb.com/list/ls006123300/</link><atom:link href="__IMDBWATCHARR_PUBLIC_ORIGIN__/radarr/l/ls006123300" /></channel></rss>`,
        }),
      ],
      ["FROM feed_items", { results: [MOVIE_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response, text } = await call(`${ORIGIN}/radarr/l/ls006123300`, { env });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/rss+xml; charset=utf-8");
    assert.match(text, new RegExp(`${ORIGIN}/radarr/l/ls006123300`));
    assert.doesNotMatch(text, /__IMDBWATCHARR_PUBLIC_ORIGIN__/);
  });

  test("radarr with no cache builds the XML from the stored items", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [MOVIE_ITEM, SERIES_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response, text } = await call(`${ORIGIN}/radarr/l/ls006123300`, { env });

    assert.equal(response.status, 200);
    assert.match(text, /<title><!\[CDATA\[My List \(Radarr\)\]\]><\/title>/);
    assert.match(text, /1 included for Radarr/, "only the movie is counted for radarr");
    assert.doesNotMatch(text, /Breaking Bad/);
  });

  test("sonarr with a cache serves the stored JSON payload verbatim", async () => {
    const payload = [{ Title: "Breaking Bad", TvdbId: 81189 }];
    const DB = makeDb([
      [
        "SELECT * FROM feeds WHERE source_url = ?",
        feedRow({ sonarr_cache: JSON.stringify(payload) }),
      ],
      ["FROM feed_items", { results: [MOVIE_ITEM, SERIES_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response, parsed } = await call(`${ORIGIN}/sonarr/l/ls006123300`, { env });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(parsed, payload);
  });

  test("sonarr with no cache builds the custom list from the TVDB ids already resolved", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [MOVIE_ITEM, SERIES_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { parsed } = await call(`${ORIGIN}/sonarr/l/ls006123300`, { env });

    assert.deepEqual(parsed, [{ Title: "Breaking Bad", TvdbId: 81189 }]);
  });

  test("the untargeted /l/ alias 302s onto the radarr route rather than serving a second identity", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [MOVIE_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const alias = await call(`${ORIGIN}/l/ls006123300`, { env });
    const targeted = await call(`${ORIGIN}/radarr/l/ls006123300`, { env });

    assert.equal(alias.response.status, 302);
    assert.equal(alias.response.headers.get("location"), `${ORIGIN}/radarr/l/ls006123300`);
    assert.equal(targeted.response.status, 200);
  });

  test("a HEAD on a feed route is served like a GET", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["FROM feed_items", { results: [MOVIE_ITEM] }],
    ]);
    const { env } = makeEnv({ DB });
    const { response } = await call(`${ORIGIN}/radarr/l/ls006123300`, { method: "HEAD", env });

    assert.equal(response.status, 200);
  });
});

describe("fetch - redirects and lookups", () => {
  test("the old /p/ path 302s onto the targeted radarr route", async () => {
    const { env } = makeEnv();
    const { response } = await call(`${ORIGIN}/p/ur12345678`, { env });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${ORIGIN}/radarr/p/ur12345678`);
  });

  test("a legacy slug feed 302s to the canonical feed URL", async () => {
    const DB = makeDb([["SELECT * FROM feeds WHERE slug = ?", feedRow()]]);
    const { env } = makeEnv({ DB });
    const { response } = await call(`${ORIGIN}/f/abcdef012345.xml`, { env });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${ORIGIN}/radarr/l/ls006123300`);
  });

  test("an unknown legacy slug is a plain 404", async () => {
    const DB = makeDb([["SELECT * FROM feeds WHERE slug = ?", null]]);
    const { env } = makeEnv({ DB });
    const { response, text } = await call(`${ORIGIN}/f/abcdef012345.xml`, { env });

    assert.equal(response.status, 404);
    assert.equal(text, "Feed not found.");
  });

  test("the status route says where a feed stands without its stored bodies, and 404s when it is missing", async () => {
    // A show with no TVDB id cannot go to Sonarr, so the preview says skipped.
    // Covers: IMDb's image host is kept and asked for a small size; any other
    // host never reaches the page's <img>.
    const COVER = "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_.jpg";
    const UNRESOLVED_SHOW = { ...SERIES_ITEM, imdb_id: "tt0000003", position: 3, title: "No TVDB", tvdb_id: null };
    const found = makeDb([
      ["SELECT * FROM feeds WHERE slug = ?", feedRow({ radarr_cache: "<rss/>", sonarr_cache: "[]" })],
      [
        "FROM feed_items WHERE feed_id",
        {
          results: [
            { ...MOVIE_ITEM, poster_url: COVER },
            { ...SERIES_ITEM, poster_url: "https://evil.example/tracker.gif" },
            UNRESOLVED_SHOW,
          ],
        },
      ],
    ]);
    const missing = makeDb([["SELECT * FROM feeds WHERE slug = ?", null]]);

    const ok = await call(`${ORIGIN}/api/feeds/abcdef012345`, { env: makeEnv({ DB: found }).env });
    assert.equal(ok.response.status, 200);
    assert.deepEqual(ok.parsed, {
      slug: "abcdef012345",
      listTitle: "My List",
      status: "ready",
      lastSyncedAt: RECENT,
      lastError: null,
      message: "Ready. Sign in and we will keep it up to date.",
      syncing: false,
      pollAfterSeconds: 30,
      owned: false,
      autoRefreshing: false,
      itemCount: 1,
      radarrCount: 1,
      sonarrCount: 1,
      sonarrUnresolvedCount: 1,
      totalCount: 3,
      preview: [
        {
          imdbId: "tt0111161",
          title: "The Shawshank Redemption",
          year: 1994,
          target: "radarr",
          poster: COVER.replace("._V1_.jpg", "._V1_QL75_UX380_.jpg"),
        },
        { imdbId: "tt0903747", title: "Breaking Bad", year: 2008, target: "sonarr", poster: null },
        { imdbId: "tt0000003", title: "No TVDB", year: 2008, target: "skipped", poster: null },
      ],
      skippedShows: ["No TVDB"],
    });
    assert.equal(found.find("INSERT OR IGNORE INTO feed_owners").length, 0, "a status read never claims");
    assert.equal(found.find("SET refresh_requested_at").length, 0, "a status read never queues");

    const gone = await call(`${ORIGIN}/api/feeds/abcdef012345`, { env: makeEnv({ DB: missing }).env });
    assert.equal(gone.response.status, 404);
    assert.deepEqual(gone.parsed, { error: "Feed not found." });
  });
});

describe("fetch - fallthrough", () => {
  test("an unrouted /api/ path is a JSON 404, not the SPA", async () => {
    const { env, assets } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/nope`, { env });

    assert.equal(response.status, 404);
    assert.deepEqual(parsed, { error: "Not found." });
    assert.equal(assets.length, 0);
  });

  test("an unrouted /auth/ path is a JSON 404 too", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/auth/nope`, { env });

    assert.equal(response.status, 404);
    assert.deepEqual(parsed, { error: "Not found." });
  });

  test("everything the API did not claim reaches the static assets binding", async () => {
    const { env, assets } = makeEnv();
    const { response, text } = await call(`${ORIGIN}/`, { env });

    assert.equal(response.status, 200);
    assert.equal(text, "<!doctype html>");
    assert.equal(assets.length, 1);
    assert.equal(assets[0].url, `${ORIGIN}/`);
  });

  test("the index is left on the asset layer's revalidating cache", async () => {
    const { env } = makeEnv();
    const { response } = await call(`${ORIGIN}/`, { env });

    assert.equal(response.headers.get("cache-control"), null);
  });

  test("a content-hashed file under /assets/ is cached for a year, immutable", async () => {
    const { env } = makeEnv();
    env.ASSETS.fetch = async () =>
      new Response("console.log(1)", {
        status: 200,
        headers: { "content-type": "text/javascript", "cache-control": "public, max-age=0, must-revalidate" },
      });
    const { response, text } = await call(`${ORIGIN}/assets/index-abc123.js`, { env });

    assert.equal(response.status, 200);
    assert.equal(text, "console.log(1)");
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("content-type"), "text/javascript");
  });

  test("the SPA fallback under /assets/ is never pinned as immutable", async () => {
    const { env } = makeEnv();
    const { response } = await call(`${ORIGIN}/assets/missing-abc123.js`, { env });

    assert.equal(response.headers.get("content-type"), "text/html");
    assert.notEqual(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  });
});
