// Sonarr keys a series on its TVDB id, which IMDb does not carry. TVMaze maps
// an IMDb id to one and, unlike IMDb, answers Cloudflare's egress.

import { filterItemsForTarget } from "./imdb.js";
import { getFeedItems, saveTvdbIds } from "./store.js";

const TVMAZE_LOOKUP_CONCURRENCY = 6;
const TVMAZE_HEADERS = {
  accept: "application/json",
  "user-agent": "imdbwatcharr/1.0 (+https://watcharr.lunarwerx.com)",
};

async function lookupTvdbIdByImdb(imdbId) {
  const response = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, {
    headers: TVMAZE_HEADERS,
    redirect: "follow",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TVMaze lookup failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const tvdbId = Number(payload?.externals?.thetvdb);
  return Number.isInteger(tvdbId) && tvdbId > 0 ? tvdbId : null;
}

/**
 * Resolve the TVDB id of every series on the feed that does not have one yet,
 * and return the feed's items with whatever was found, plus how many resolved.
 * A series TVMaze cannot answer for stays unresolved and is simply tried again
 * next time, so one failed lookup never fails the request it rides on.
 */
export async function resolveMissingTvdbIds(env, feed, items) {
  const seriesItems = filterItemsForTarget(items, "sonarr").filter((item) => !item.tvdb_id);
  if (!seriesItems.length) {
    return { items, resolvedCount: 0 };
  }

  const resolutions = [];

  // TVMaze is a third party, so keep the lookups bounded rather than firing one
  // request per series at once.
  for (let offset = 0; offset < seriesItems.length; offset += TVMAZE_LOOKUP_CONCURRENCY) {
    const batch = seriesItems.slice(offset, offset + TVMAZE_LOOKUP_CONCURRENCY);
    const results = await Promise.all(
      batch.map((item) =>
        lookupTvdbIdByImdb(item.imdb_id).then(
          (tvdbId) => ({ imdbId: item.imdb_id, tvdbId }),
          () => ({ imdbId: item.imdb_id, tvdbId: null }),
        ),
      ),
    );
    resolutions.push(...results.filter((result) => result.tvdbId));
  }

  if (!resolutions.length) {
    return { items, resolvedCount: 0 };
  }

  await saveTvdbIds(env.DB, feed.id, resolutions);
  return { items: await getFeedItems(env.DB, feed.id), resolvedCount: resolutions.length };
}

export async function enrichTvdbIdsForFeed(env, feed, items) {
  return (await resolveMissingTvdbIds(env, feed, items)).items;
}
