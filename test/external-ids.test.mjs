import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTmdbIds, resolveTvdbIds } from "../src/external-ids.js";

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

// Radarr's own list type keys a movie on its TMDB id. A miss is an answer (0,
// stored so it is not asked again); a failed call is not (left out, retried).
test("a movie's TMDB id comes from TMDB, a movie it lacks is 0, and a failed lookup is left for later", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === "/3/find/tt0000001") return Response.json({ movie_results: [{ id: 603 }], tv_results: [] });
    if (url.pathname === "/3/find/tt0000002") return Response.json({ movie_results: [], tv_results: [{ id: 5 }] });
    if (url.pathname === "/3/find/tt0000003") return new Response("busy", { status: 503 });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const found = await resolveTmdbIds({ TMDB_TOKEN: "token" }, ["tt0000001", "tt0000002", "tt0000003"]);

    assert.deepEqual(Object.fromEntries(found), { tt0000001: 603, tt0000002: 0 });
  } finally {
    globalThis.fetch = realFetch;
  }
});
