// The sync job's two routes (src/sync.js): what /api/sync-targets hands the
// GitHub runner and what /api/ingest does with its answers. Same harness as
// worker-routes.test.mjs, split out when that file passed 1,000 lines.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ORIGIN,
  INGEST_SECRET,
  CANONICAL_LIST,
  makeDb,
  makeEnv,
  call,
  RECENT,
  feedRow,
} from "./support/worker-harness.mjs";

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
          listId: "ls055592025",
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

