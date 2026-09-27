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

import worker from "../src/index.js";

const ORIGIN = "https://imdbwatcharr.pages.dev";
const SESSION_SECRET = "test-session-secret";
const INGEST_SECRET = "test-ingest-secret";
const CANONICAL_LIST = "https://www.imdb.com/list/ls006123300/";

/**
 * A stub D1. `rules` is a list of [substring, value] pairs matched against the
 * whitespace-normalised SQL; a value may be a function of the bound args. An
 * unmatched statement falls through to the empty shape for its kind, which is
 * how a test notices it forgot to describe a query: the caller sees no row.
 */
function makeDb(rules = []) {
  const calls = [];
  const resolve = (sql, args, kind) => {
    for (const [needle, value] of rules) {
      if (sql.includes(needle)) {
        return typeof value === "function" ? value(args, kind) : value;
      }
    }
    return undefined;
  };

  function statement(sql, args) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    return {
      bind: (...next) => statement(sql, next),
      async first() {
        calls.push({ sql: normalized, args, kind: "first" });
        const value = resolve(normalized, args, "first");
        return value === undefined ? null : value;
      },
      async all() {
        calls.push({ sql: normalized, args, kind: "all" });
        const value = resolve(normalized, args, "all");
        return value === undefined ? { results: [] } : value;
      },
      async run() {
        calls.push({ sql: normalized, args, kind: "run" });
        const value = resolve(normalized, args, "run");
        return value === undefined ? { success: true } : value;
      },
    };
  }

  return {
    calls,
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      calls.push({ sql: `batch(${statements.length})`, args: [], kind: "batch" });
      return statements.map(() => ({ success: true }));
    },
    find: (needle) => calls.filter((call) => call.sql.includes(needle)),
  };
}

function makeEnv({ DB = makeDb(), ...extra } = {}) {
  const assets = [];
  const env = {
    DB,
    ASSETS: {
      fetch: async (request) => {
        assets.push(request);
        return new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    },
    ...extra,
  };
  return { env, assets };
}

function makeCtx() {
  const waited = [];
  return { waited, waitUntil: (promise) => waited.push(promise) };
}

/** The cookie src/auth.js would have issued, built from the same wire format. */
async function sessionCookie(sub, name = null) {
  const b64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const body = b64url(
    new TextEncoder().encode(
      JSON.stringify({ sub, name, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `iw_session=${body}.${b64url(signature)}`;
}

async function call(url, { method = "GET", body, headers = {}, env, ctx } = {}) {
  const request = new Request(url, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const response = await worker.fetch(request, env, ctx ?? makeCtx());
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { response, text, parsed };
}

const RECENT = new Date(Date.now() - 60_000).toISOString();

function feedRow(overrides = {}) {
  return {
    id: 7,
    slug: "abcdef012345",
    source_url: CANONICAL_LIST,
    source_kind: "list",
    status: "ready",
    item_count: 2,
    list_title: "My List",
    list_author: "Ada",
    list_id: "ls006123300",
    last_error: null,
    consecutive_failures: 0,
    last_synced_at: RECENT,
    source_fingerprint: null,
    radarr_cache: null,
    sonarr_cache: null,
    cache_updated_at: null,
    updated_at: RECENT,
    ...overrides,
  };
}

const MOVIE_ITEM = {
  imdb_id: "tt0111161",
  tvdb_id: null,
  position: 1,
  title: "The Shawshank Redemption",
  year: 1994,
  title_type: "movie",
  added_at: null,
};

const SERIES_ITEM = {
  imdb_id: "tt0903747",
  tvdb_id: 81189,
  position: 2,
  title: "Breaking Bad",
  year: 2008,
  title_type: "tvSeries",
  added_at: null,
};

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

describe("fetch - /api/sync-targets", () => {
  const SYNC_ROW = {
    source_url: CANONICAL_LIST,
    source_kind: "list",
    status: "ready",
    last_synced_at: RECENT,
    source_fingerprint: "a".repeat(32),
    refresh_requested_at: null,
    owned: 1,
  };
  // A list a signed-out visitor pasted: nobody owns it, and it has never been read.
  const GUEST_LIST = "https://www.imdb.com/list/ls000000042/";
  const REQUESTED_ROW = {
    ...SYNC_ROW,
    source_url: GUEST_LIST,
    status: "pending",
    last_synced_at: null,
    source_fingerprint: null,
    refresh_requested_at: RECENT,
    owned: 0,
  };
  const queueDb = () =>
    makeDb([
      ["AND NOT EXISTS (SELECT 1 FROM feed_owners", { results: [REQUESTED_ROW] }],
      ["WHERE EXISTS (SELECT 1 FROM feed_owners", { results: [SYNC_ROW] }],
    ]);

  test("with no configured secret the endpoint does not exist, rather than being open", async () => {
    const { env } = makeEnv();
    const { response, parsed } = await call(`${ORIGIN}/api/sync-targets`, { env });

    assert.equal(response.status, 401);
    assert.deepEqual(parsed, { error: "Unauthorized." });
  });

  test("a wrong bearer token is rejected", async () => {
    const { env } = makeEnv({ INGEST_SECRET });
    const { response } = await call(`${ORIGIN}/api/sync-targets`, {
      env,
      headers: { authorization: "Bearer nope" },
    });

    assert.equal(response.status, 401);
  });

  // The 2026-09 outage: only claimed feeds were ever handed to the runner, so a
  // list pasted by a signed-out visitor was never read and served 503 forever.
  test("the queue comes first, owned or not, then every claimed feed", async () => {
    const { env } = makeEnv({ DB: queueDb(), INGEST_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/sync-targets`, {
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(parsed.feeds, [
      {
        sourceUrl: GUEST_LIST,
        sourceKind: "list",
        status: "pending",
        lastSyncedAt: null,
        fingerprint: null,
        stale: true,
        owned: false,
        requested: true,
      },
      {
        sourceUrl: CANONICAL_LIST,
        sourceKind: "list",
        status: "ready",
        lastSyncedAt: RECENT,
        fingerprint: "a".repeat(32),
        stale: false,
        owned: true,
        requested: false,
      },
    ]);
  });

  test("scope=requested is the queue alone, which is all a dispatched run needs", async () => {
    const { env } = makeEnv({ DB: queueDb(), INGEST_SECRET });
    const { parsed } = await call(`${ORIGIN}/api/sync-targets?scope=requested`, {
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.deepEqual(
      parsed.feeds.map((feed) => feed.sourceUrl),
      [GUEST_LIST],
    );
  });
});

describe("fetch - /api/ingest", () => {
  test("without the secret it is 401 and the body is never read", async () => {
    const DB = makeDb();
    const { env } = makeEnv({ DB });
    const { response, parsed } = await call(`${ORIGIN}/api/ingest`, {
      method: "POST",
      body: { error: "boom" },
      env,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(parsed, { error: "Unauthorized." });
    assert.equal(DB.calls.length, 0);
  });

  test("a reported sync failure is recorded against the feed and acknowledged", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow()],
      ["consecutive_failures = consecutive_failures + 1", { success: true }],
    ]);
    const { env } = makeEnv({ DB, INGEST_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/ingest`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST, error: "This IMDb list is private.", permanent: true },
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(parsed, { ok: true, recorded: "error" });
    const [failure] = DB.find("consecutive_failures = consecutive_failures + 1");
    // The message, whether the failure is permanent (so the queue drops it),
    // the give-up threshold, the timestamp, and the feed.
    // Then the give-up cutoff (a request waiting a day) and the timestamp.
    assert.deepEqual(failure.args, ["This IMDb list is private.", 1, 3, failure.args[3], failure.args[4], 7]);
  });

  test("an empty snapshot is rejected before it can wipe a feed that has titles", async () => {
    const DB = makeDb([["SELECT * FROM feeds WHERE source_url = ?", feedRow({ item_count: 2 })]]);
    const { env } = makeEnv({ DB, INGEST_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/ingest`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST, snapshot: { items: [] } },
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.equal(response.status, 400);
    assert.match(parsed.error, /empty list for a feed that had titles/);
    assert.equal(DB.find("FROM feed_items").length, 0, "a rejected snapshot must not reach the table");
  });

  test("an empty list is a real answer for a feed that has never had anything", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ status: "pending", item_count: 0, last_synced_at: null })],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB, INGEST_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/ingest`, {
      method: "POST",
      body: { sourceUrl: CANONICAL_LIST, snapshot: { listTitle: "Empty", items: [] } },
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.itemCount, 0);
  });

  test("a well-formed snapshot is stored and the new state is reported back", async () => {
    const DB = makeDb([
      ["SELECT * FROM feeds WHERE source_url = ?", feedRow({ status: "pending", item_count: 0 })],
      ["FROM feed_items", { results: [] }],
    ]);
    const { env } = makeEnv({ DB, INGEST_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/ingest`, {
      method: "POST",
      body: {
        sourceUrl: CANONICAL_LIST,
        snapshot: {
          listTitle: "My List",
          listAuthor: "Ada",
          listId: "ls006123300",
          items: [{ imdbId: "tt0111161", title: "The Shawshank Redemption", year: 1994, titleType: "movie" }],
        },
      },
      env,
      headers: { authorization: `Bearer ${INGEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      { ok: parsed.ok, slug: parsed.slug, status: parsed.status, itemCount: parsed.itemCount },
      { ok: true, slug: "abcdef012345", status: "ready", itemCount: 1 },
    );
    assert.match(parsed.fingerprint, /^[a-f0-9]{32}$/);
    // delete + one insert + the feed update, all in one batch.
    assert.equal(DB.find("batch(3)").length, 1);
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
      message:
        "Your list is in the queue. We read queued lists from IMDb about every fifteen minutes, and this page updates by itself when it lands.",
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
    const found = makeDb([
      ["SELECT * FROM feeds WHERE slug = ?", feedRow({ radarr_cache: "<rss/>", sonarr_cache: "[]" })],
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
      itemCount: 0,
      radarrCount: 0,
      sonarrCount: 0,
      sonarrUnresolvedCount: 0,
      totalCount: 0,
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
