// Radarr and Sonarr key a title on an id IMDb does not carry: Sonarr a series on
// its TVDB id, and Radarr's own list type (the one it re-reads every 15 minutes)
// a movie on its TMDB id. Both are looked up by the IMDb id we have.
//
// TVDB: two sources, both answering Cloudflare's egress where IMDb does not:
// TVMaze first, then TMDB, which links many shows TVMaze has without their IMDb
// id (measured 2026-09-28: TMDB found 17 of the 36 shows TVMaze missed across
// every stored list). What neither knows is usually a show that was announced
// and never made, which no source can map because TVDB has no entry for it.
//
// TMDB: its /find by IMDb id, one call per movie.

import { tmdbGet } from "./tmdb-details.js";

const LOOKUP_CONCURRENCY = 6;
// A show neither source knows is not asked about again for a day, so each sync
// and each Sonarr poll does not send the same unanswerable questions again.
const MISS_CACHE_SECONDS = 60 * 60 * 24;
const TVMAZE_HEADERS = {
  accept: "application/json",
  "user-agent": "imdbwatcharr/1.0 (+https://watcharr.lunarwerx.com)",
};

function positiveId(value) {
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
  return positiveId(payload?.externals?.thetvdb);
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
  return positiveId(ids?.tvdb_id);
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
 * One movie's TMDB id, 0 when TMDB answered and has no movie for it (stored, so
 * it is not asked again until the list changes), or undefined when TMDB could
 * not be asked or did not answer (left for a later sync).
 */
async function lookupTmdbId(env, imdbId) {
  if (!env.TMDB_TOKEN) {
    return undefined;
  }
  const found = await tmdbGet(env, `/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" });
  return positiveId(found?.movie_results?.[0]?.id) ?? 0;
}

/**
 * Look each IMDb id up with `lookup`, keeping the answers that are not null or
 * undefined. Every source here is a third party, so at most LOOKUP_CONCURRENCY
 * lookups are out at once, each worker taking the next id as soon as its last
 * one answers, and one that fails is simply left out, so it never fails the
 * sync it rides on.
 */
async function resolveEach(imdbIds, lookup) {
  const found = new Map();
  const queue = [...imdbIds];
  const worker = async () => {
    // arkitect-allow: concurrency-opportunities - this loop IS the bound: LOOKUP_CONCURRENCY copies run side by side, so going wider would fire every lookup at a third party at once.
    for (let imdbId = queue.shift(); imdbId; imdbId = queue.shift()) {
      const id = await lookup(imdbId).catch(() => undefined);
      if (id !== null && id !== undefined) found.set(imdbId, id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, worker));
  return found;
}

/** The TVDB ids of these shows, as a Map of the ones found; the rest are tried again on a later sync. */
export function resolveTvdbIds(env, imdbIds) {
  return resolveEach(imdbIds, (imdbId) => lookupTvdbId(env, imdbId));
}

/** The TMDB ids of these movies, as a Map; 0 for one TMDB does not have, and none for one it did not answer. */
export function resolveTmdbIds(env, imdbIds) {
  return resolveEach(imdbIds, (imdbId) => lookupTmdbId(env, imdbId));
}
