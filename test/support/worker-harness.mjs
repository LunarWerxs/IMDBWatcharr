// The Worker test harness: a stub D1 that answers each prepared statement from
// a rule table, a stub ASSETS binding, the session cookie src/auth.js issues,
// and the rows the route tests share. Split out of worker-routes.test.mjs when
// it passed 1,000 lines (Architect, 2026-09-27); see that file for what the
// harness does and does not cover.
import worker from "../../src/index.js";

export const ORIGIN = "https://imdbwatcharr.pages.dev";
export const SESSION_SECRET = "test-session-secret";
export const INGEST_SECRET = "test-ingest-secret";
export const CANONICAL_LIST = "https://www.imdb.com/list/ls006123300/";

/**
 * A stub D1. `rules` is a list of [substring, value] pairs matched against the
 * whitespace-normalised SQL; a value may be a function of the bound args. An
 * unmatched statement falls through to the empty shape for its kind, which is
 * how a test notices it forgot to describe a query: the caller sees no row.
 */
export function makeDb(rules = []) {
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

export function makeEnv({ DB = makeDb(), ...extra } = {}) {
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

export function makeCtx() {
  const waited = [];
  return { waited, waitUntil: (promise) => waited.push(promise) };
}

/** The cookie src/auth.js would have issued, built from the same wire format. */
export async function sessionCookie(sub, name = null) {
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

export async function call(url, { method = "GET", body, headers = {}, env, ctx } = {}) {
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

export const RECENT = new Date(Date.now() - 60_000).toISOString();

export function feedRow(overrides = {}) {
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

export const MOVIE_ITEM = {
  imdb_id: "tt0111161",
  tvdb_id: null,
  position: 1,
  title: "The Shawshank Redemption",
  year: 1994,
  title_type: "movie",
  added_at: null,
};

export const SERIES_ITEM = {
  imdb_id: "tt0903747",
  tvdb_id: 81189,
  position: 2,
  title: "Breaking Bad",
  year: 2008,
  title_type: "tvSeries",
  added_at: null,
};

