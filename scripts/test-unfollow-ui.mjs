// WHY: My Feeds' new Unfollow button (web/src/components/my-feeds.tsx) leans
// entirely on unfollowFeed's request contract in web/src/lib/api.ts - what it
// POSTs, and how it turns a non-2xx response into the error text the toast
// shows. That function is plain, dependency-free TypeScript (no React, no
// bundler needed), so Node can import it directly (native type-stripping)
// and it gets the same assert()-based check scripts/test-parser.mjs already
// gives the backend parser code, instead of shipping untested. Not wired into
// `npm run check`/CI's node-version:22 job, since type-stripping support
// there is unverified from this worktree - run directly with
// `node scripts/test-unfollow-ui.mjs` (or `npm run check:web`).
import assert from "node:assert/strict";

import { unfollowFeed } from "../web/src/lib/api.ts";

/** Answers each fetch call from a queue and records what it was called with, mirroring test-parser.mjs's stubFetch. */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error("Stub fetch ran out of responses.");
    }
    return typeof next === "function" ? next() : next;
  };
  impl.calls = calls;
  return impl;
}

async function withStubFetch(responses, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(responses);
  try {
    await run(globalThis.fetch);
  } finally {
    globalThis.fetch = original;
  }
}

// A successful unfollow should POST the feed's own source URL to
// /api/unfollow - the exact contract src/index.js's POST /api/unfollow
// handler expects - and resolve without throwing.
await withStubFetch(
  [{ ok: true, status: 200, json: async () => ({ ok: true }) }],
  async (fetchStub) => {
    await unfollowFeed("https://www.imdb.com/list/ls008777572/");
    assert.equal(fetchStub.calls.length, 1, "unfollowFeed should make exactly one request.");
    const [{ url, init }] = fetchStub.calls;
    assert.equal(url, "/api/unfollow", "unfollowFeed should POST to /api/unfollow.");
    assert.equal(init.method, "POST", "unfollowFeed should use POST.");
    assert.equal(init.headers["content-type"], "application/json", "unfollowFeed should send JSON.");
    assert.deepEqual(
      JSON.parse(init.body),
      { sourceUrl: "https://www.imdb.com/list/ls008777572/" },
      "unfollowFeed should send the feed's source URL as JSON.",
    );
  },
);

// A server error should surface the backend's own message - e.g. "Sign in
// first." if the session expired mid-click - not a generic failure, since
// that message is the only thing telling the visitor why nothing happened.
await withStubFetch(
  [{ ok: false, status: 401, json: async () => ({ error: "Sign in first." }) }],
  async () => {
    await assert.rejects(
      unfollowFeed("https://www.imdb.com/list/ls008777572/"),
      /Sign in first\./,
      "unfollowFeed should surface the backend's own error message.",
    );
  },
);

// An unreadable error body should still fail loudly, with the HTTP status
// rather than a JSON-parse crash reaching the caller.
await withStubFetch(
  [
    {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    },
  ],
  async () => {
    await assert.rejects(
      unfollowFeed("https://www.imdb.com/list/ls008777572/"),
      /status 500/,
      "unfollowFeed should fall back to the HTTP status when the error body is unreadable.",
    );
  },
);

console.log("Unfollow UI checks passed.");
