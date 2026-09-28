// Sonarr keys a series on its TVDB id, which IMDb does not carry. Two sources
// map an IMDb id to one, and both answer Cloudflare's egress where IMDb does
// not: TVMaze first, then TMDB, which links many shows TVMaze has without
// their IMDb id (measured 2026-09-28: TMDB found 17 of the 36 shows TVMaze
// missed across every stored list). What neither knows is usually a show that
// was announced and never made, which no source can map because TVDB has no
// entry for it.

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
 * The TVDB ids of these shows, as a Map of the ones found. A show no source
 * can answer for is left out and tried again on a later sync, so one failed
 * lookup never fails the read it rides on. Both sources are third parties, so
 * at most LOOKUP_CONCURRENCY lookups are out at once, each worker taking the
 * next show as soon as its last one answers.
 */
export async function resolveTvdbIds(env, imdbIds) {
  const found = new Map();
  const queue = [...imdbIds];
  const worker = async () => {
    for (let imdbId = queue.shift(); imdbId; imdbId = queue.shift()) {
      const tvdbId = await lookupTvdbId(env, imdbId).catch(() => null);
      if (tvdbId) found.set(imdbId, tvdbId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, worker));
  return found;
}
