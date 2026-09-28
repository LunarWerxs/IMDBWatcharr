// My feeds' Unfollow button (web/src/components/my-feeds.tsx) leans entirely on
// unfollowFeed's request contract in web/src/lib/api.ts: what it POSTs, and how
// it turns a non-2xx answer into the error text the toast shows. It is plain
// TypeScript, which Node (22.18 and up) imports by stripping the types.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { unfollowFeed } from "../web/src/lib/api.ts";

const LIST = "https://www.imdb.com/list/ls008777572/";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The page's fetch, answering once and recording what it was asked. */
function answer(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return calls;
}

test("unfollowing POSTs the feed's own source URL to /api/unfollow as JSON", async () => {
  const calls = answer({ ok: true, status: 200, json: async () => ({ ok: true }) });

  await unfollowFeed(LIST);

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "/api/unfollow");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { sourceUrl: LIST });
});

// The server's own words ("Sign in first." after a session expired mid-click)
// are the only thing telling the visitor why nothing happened.
test("a refusal surfaces the server's own message", async () => {
  answer({ ok: false, status: 401, json: async () => ({ error: "Sign in first." }) });

  await assert.rejects(unfollowFeed(LIST), /Sign in first\./);
});

test("an unreadable error body still fails, with the HTTP status", async () => {
  answer({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error("not json");
    },
  });

  await assert.rejects(unfollowFeed(LIST), /status 500/);
});
