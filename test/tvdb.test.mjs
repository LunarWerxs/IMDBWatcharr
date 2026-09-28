import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMissingTvdbIds } from "../src/tvdb.js";

// TVMaze and TMDB are the far side of the boundary; the lookup order, the
// fallback and what gets saved are real.
test("a show TVMaze has no IMDb link for still gets its TVDB id, from TMDB", async () => {
  const saved = [];
  const DB = {
    prepare: (sql) => ({ bind: (...args) => ({ sql, args, all: async () => ({ results: [] }) }) }),
    batch: async (statements) => {
      saved.push(...statements.map((statement) => statement.args));
      return [];
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "api.tvmaze.com") return new Response("", { status: 404 });
    if (url.pathname === "/3/find/tt0000009") return Response.json({ tv_results: [{ id: 77 }] });
    if (url.pathname === "/3/tv/77/external_ids") return Response.json({ tvdb_id: 4242 });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const { resolvedCount } = await resolveMissingTvdbIds({ DB, TMDB_TOKEN: "token" }, { id: 1 }, [
      { imdb_id: "tt0000009", title: "Drops of God", title_type: "tvSeries", tvdb_id: null },
    ]);

    assert.equal(resolvedCount, 1);
    assert.deepEqual(saved, [[4242, 1, "tt0000009"]]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
