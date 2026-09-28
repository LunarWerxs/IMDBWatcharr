// Sonarr keys a series on its TVDB id, which IMDb does not carry. Two sources
// map an IMDb id to one, and both answer Cloudflare's egress where IMDb does
// not: TVMaze first, then TMDB, which links many shows TVMaze has without
// their IMDb id (measured 2026-09-28: TMDB found 17 of the 36 shows TVMaze
// missed across every stored list). What neither knows is usually a show that
// was announced and never made, which no source can map because TVDB has no
// entry for it.

import { filterItemsForTarget } from "./imdb.js";
import { getFeedItems, saveTvdbIds } from "./store.js";
import { tmdbGet } from "./tmdb-details.js";

const LOOKUP_CONCURRENCY = 6;
// A show neither source knows is not asked about again for a day, so each sync
// and each Sonarr poll does not send the same unanswerable questions again.
const MISS_CACHE_SECONDS = 60 * 60 * 24;
const TVMAZE_HEADERS = {
  accept: "application/json",
  "user-agent": "imdbwatcharr/1.0 (+https://watcharr.lunarwerx.com)",
};

function tvdbIdOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function viaTvmaze(imdbId) {
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
  return tvdbIdOf(payload?.externals?.thetvdb);
}

async function viaTmdb(env, imdbId) {
  if (!env.TMDB_TOKEN) {
    return null;
  }

  const found = await tmdbGet(env, `/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" });
  const show = found?.tv_results?.[0];
  if (!show?.id) {
    return null;
  }

  const ids = await tmdbGet(env, `/tv/${show.id}/external_ids`);
  return tvdbIdOf(ids?.tvdb_id);
}

/**
 * One series' TVDB id, or null. A source that fails is not an answer, so the
 * other is still asked, and a miss is only remembered when both answered.
 */
async function lookupTvdbId(env, imdbId) {
  const cache = typeof caches === "undefined" || !env.PUBLIC_ORIGIN ? null : caches.default;
  const missKey = cache ? new Request(`${env.PUBLIC_ORIGIN}/__tvdb-miss/${encodeURIComponent(imdbId)}`) : null;
  if (missKey && (await cache.match(missKey))) {
    return null;
  }

  let bothAnswered = true;
  const unanswered = () => {
    bothAnswered = false;
    return null;
  };
  const tvdbId = (await viaTvmaze(imdbId).catch(unanswered)) ?? (await viaTmdb(env, imdbId).catch(unanswered));

  if (!tvdbId && bothAnswered && missKey) {
    await cache.put(missKey, new Response("", { headers: { "cache-control": `max-age=${MISS_CACHE_SECONDS}` } }));
  }
  return tvdbId;
}

/**
 * Resolve the TVDB id of every series on the feed that does not have one yet,
 * and return the feed's items with whatever was found, plus how many resolved.
 * A series no source can answer for stays unresolved and is tried again on a
 * later sync, so one failed lookup never fails the request it rides on.
 */
export async function resolveMissingTvdbIds(env, feed, items) {
  const seriesItems = filterItemsForTarget(items, "sonarr").filter((item) => !item.tvdb_id);
  if (!seriesItems.length) {
    return { items, resolvedCount: 0 };
  }

  const resolutions = [];

  // Both sources are third parties, so keep the lookups bounded rather than
  // firing one request per series at once.
  for (let offset = 0; offset < seriesItems.length; offset += LOOKUP_CONCURRENCY) {
    const batch = seriesItems.slice(offset, offset + LOOKUP_CONCURRENCY);
    const results = await Promise.all(
      batch.map((item) =>
        lookupTvdbId(env, item.imdb_id).then(
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
