// WHY: node --test discovery over src/imdb-graphql.js's pure logic -
// pagination, dedupe, and error translation are what stand between IMDb's
// GraphQL API and a feed snapshot, and they never touch the real network
// here: every case injects a stub fetchImpl, the same pattern
// scripts/test-parser.mjs already used. Ports its fixture-backed assertions
// into node:test so `npm test` discovers them directly.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshotFingerprintPayload, fetchImdbList, NotFoundError } from "../src/imdb-graphql.js";
import { normalizeImdbUrl } from "../src/imdb.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(rootDir, "fixtures", name), "utf8"));
}

/** A fetch stand-in that answers each GraphQL call from a queue and records what it was called with. */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const next = queue.shift();
    if (!next) {
      throw new Error("Stub fetch ran out of responses.");
    }
    if (typeof next === "function") {
      return next(body);
    }
    return { ok: true, status: 200, json: async () => next };
  };
  impl.calls = calls;
  return impl;
}

describe("fetchImdbList - lists", () => {
  test("parses a single-page list fixture", async () => {
    const fixture = await readFixture("list-graphql.json");
    const fetchStub = stubFetch([fixture]);
    const result = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), fetchStub);

    assert.equal(fetchStub.calls.length, 1, "a single-page list should take exactly one request");
    assert.equal(fetchStub.calls[0].variables.after, null, "the first page should not send a cursor");
    assert.equal(result.items.length, 3);
    assert.equal(result.listAuthor, "IMikeDB");
    assert.equal(result.items[0].imdbId, "tt0423977");
  });
});

describe("fetchImdbList - watchlists", () => {
  test("resolves a p. profile id to a ur id before fetching the list", async () => {
    const profileFixture = await readFixture("profile-graphql.json");
    const watchlistFixture = await readFixture("watchlist-graphql.json");
    const fetchStub = stubFetch([profileFixture, watchlistFixture]);
    const normalized = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/");

    const result = await fetchImdbList(normalized, fetchStub);

    assert.equal(fetchStub.calls.length, 2, "a p. watchlist should resolve the profile, then fetch the list");
    assert.equal(fetchStub.calls[1].variables.userId, "ur15738437");
    assert.equal(result.items.length, 3);
  });

  test("skips the profile lookup for an already-resolved ur id", async () => {
    const watchlistFixture = await readFixture("watchlist-graphql.json");
    const fetchStub = stubFetch([watchlistFixture]);
    const normalized = normalizeImdbUrl("https://www.imdb.com/user/ur15738437/watchlist/");

    await fetchImdbList(normalized, fetchStub);

    assert.equal(fetchStub.calls.length, 1, "a ur watchlist should query directly, with no profile lookup");
  });
});

describe("fetchImdbList - paging and dedupe", () => {
  function pageOf(edges, hasNextPage, endCursor) {
    return {
      data: {
        list: {
          id: "ls000000001",
          name: { originalText: "Paged" },
          lastModifiedDate: "2026-08-01T00:00:00Z",
          author: { userId: "ur1", username: { text: "someone" } },
          titleListItemSearch: { total: edges.length, pageInfo: { hasNextPage, endCursor }, edges },
        },
      },
    };
  }

  function edgeOf(id, position) {
    return {
      node: { absolutePosition: position, createdDate: "2026-01-01T00:00:00.000Z" },
      title: {
        id,
        titleText: { text: `Title ${id}` },
        titleType: { id: "movie" },
        releaseYear: { year: 2020 },
      },
    };
  }

  test("follows the cursor across pages and preserves list order", async () => {
    const fetchStub = stubFetch([
      pageOf([edgeOf("tt0000001", 1), edgeOf("tt0000002", 2)], true, "cursor-1"),
      pageOf([edgeOf("tt0000003", 3)], false, null),
    ]);
    const result = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), fetchStub);

    assert.equal(fetchStub.calls[1].variables.after, "cursor-1", "the second page should send the previous end cursor");
    assert.deepEqual(result.items.map((item) => item.imdbId), ["tt0000001", "tt0000002", "tt0000003"]);
    assert.equal(result.totalItems, 3);
  });

  test("collapses a repeated title and keeps its earliest position", async () => {
    const fetchStub = stubFetch([
      pageOf([edgeOf("tt0000001", 1)], true, "cursor-1"),
      pageOf([edgeOf("tt0000001", 3), edgeOf("tt0000002", 4)], false, null),
    ]);
    const result = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), fetchStub);

    assert.equal(result.items.length, 2, "a duplicated title should be collapsed");
    assert.equal(result.items[0].position, 1, "dedupe should keep the earliest position");
  });

  test("stops on an empty follow-up page instead of looping forever", async () => {
    const fetchStub = stubFetch([
      pageOf([edgeOf("tt0000001", 1)], true, "cursor-1"),
      pageOf([], true, "cursor-2"),
    ]);
    const result = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), fetchStub);

    assert.equal(result.items.length, 1);
  });

  test("throws instead of silently truncating a runaway list", async () => {
    const pages = Array.from({ length: 41 }, (_, index) => pageOf([edgeOf(`tt000${index + 1000}`, index + 1)], true, `c${index}`));

    await assert.rejects(
      fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), stubFetch(pages)),
      /did not finish paging/,
    );
  });
});

describe("fetchImdbList - failure modes", () => {
  test("rejects a missing list with a NotFoundError", async () => {
    await assert.rejects(
      fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), stubFetch([{ data: { list: null } }])),
      NotFoundError,
    );
  });

  test("surfaces a GraphQL error's own message", async () => {
    await assert.rejects(
      fetchImdbList(
        normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
        stubFetch([{ errors: [{ message: "Something unexpected" }] }]),
      ),
      /IMDb GraphQL error: Something unexpected/,
    );
  });

  test("translates IMDb's stack-trace-shaped not-found error into plain language", async () => {
    await assert.rejects(
      fetchImdbList(
        normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
        stubFetch([{ errors: [{ message: "RESOURCE_NOT_FOUND exception code while fetching data (/list/author)" }] }]),
      ),
      /IMDb has nothing public at that link\. It may be private, or the id may be wrong\./,
    );
  });

  test("rejects a non-2xx HTTP response", async () => {
    await assert.rejects(
      fetchImdbList(
        normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
        stubFetch([() => ({ ok: false, status: 403, json: async () => ({}) })]),
      ),
      /status 403/,
    );
  });

  test("rejects an unresolvable p. profile id", async () => {
    await assert.rejects(
      fetchImdbList(
        normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/"),
        stubFetch([{ data: { userProfile: null } }]),
      ),
      /no public profile at/,
    );
  });
});

describe("buildSnapshotFingerprintPayload", () => {
  test("is stable across two fetches of the same unchanged list", async () => {
    const fixture = await readFixture("list-graphql.json");
    const first = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), stubFetch([fixture]));
    const second = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), stubFetch([fixture]));

    assert.equal(
      buildSnapshotFingerprintPayload(first),
      buildSnapshotFingerprintPayload(second),
      "the same list payload must produce the same fingerprint, or every sync rebuilds",
    );
  });

  test("changes when an item's title changes", async () => {
    const fixture = await readFixture("list-graphql.json");
    const snapshot = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), stubFetch([fixture]));
    const before = buildSnapshotFingerprintPayload(snapshot);
    const mutated = {
      ...snapshot,
      items: snapshot.items.map((item, index) => (index === 0 ? { ...item, title: "Changed Title" } : item)),
    };

    assert.notEqual(before, buildSnapshotFingerprintPayload(mutated));
  });
});
