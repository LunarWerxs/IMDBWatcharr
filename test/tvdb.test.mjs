import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTvdbIds } from "../src/tvdb.js";

// TVMaze and TMDB are the far side of the boundary; the lookup order and the
// fallback are real.
test("a show TVMaze has no IMDb link for still gets its TVDB id, from TMDB", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "api.tvmaze.com") return new Response("", { status: 404 });
    if (url.pathname === "/3/find/tt0000009") return Response.json({ tv_results: [{ id: 77 }] });
    if (url.pathname === "/3/tv/77/external_ids") return Response.json({ tvdb_id: 4242 });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const found = await resolveTvdbIds({ TMDB_TOKEN: "token" }, ["tt0000009"]);

    assert.deepEqual([...found], [["tt0000009", 4242]]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
