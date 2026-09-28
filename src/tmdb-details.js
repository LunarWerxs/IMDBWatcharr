// The poster popup's details: plot, genres, runtime, rating, a backdrop and a
// trailer, from TMDB, looked up by the IMDb id we already store. TMDB answers
// Cloudflare where IMDb does not, so the Worker can fetch these itself, on the
// visitor's click, and each title is cached for a day. Needs TMDB_TOKEN (a
// TMDB v4 read access token); without it the popup shows what the list gave us.
import { json } from "./http.js";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGES = "https://image.tmdb.org/t/p";
const TMDB_TIMEOUT_MS = 6_000;
const FOUND_CACHE_SECONDS = 60 * 60 * 24;
const MISSING_CACHE_SECONDS = 60 * 60;

// Only shapes TMDB actually issues get into a URL the page loads.
const IMAGE_PATH = /^\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i;
const YOUTUBE_KEY = /^[\w-]{6,20}$/;

/** The one TMDB client: the popup's details here, and TVDB ids in tvdb.js. */
export async function tmdbGet(env, path, params = {}) {
  const url = new URL(`${TMDB_API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TMDB answered ${response.status}.`);
  return response.json();
}

function image(path, size) {
  return typeof path === "string" && IMAGE_PATH.test(path) ? `${TMDB_IMAGES}/${size}${path}` : null;
}

function yearOf(date) {
  return typeof date === "string" && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
}

/** The popup's shape for one title, or null when TMDB does not know the IMDb id. */
export async function getTitleDetails(env, imdbId) {
  const found = await tmdbGet(env, `/find/${imdbId}`, { external_source: "imdb_id", language: "en-US" });
  const movie = found?.movie_results?.[0];
  const show = found?.tv_results?.[0];
  const hit = movie ?? show;
  if (!hit?.id) return null;

  const mediaType = movie ? "movie" : "tv";
  const data = await tmdbGet(env, `/${mediaType}/${hit.id}`, { append_to_response: "videos", language: "en-US" });

  const videos = Array.isArray(data?.videos?.results) ? data.videos.results : [];
  const youtube = videos.filter((video) => video.site === "YouTube" && YOUTUBE_KEY.test(String(video.key)));
  const trailer = youtube.find((video) => video.type === "Trailer") ?? youtube[0];

  return {
    imdbId,
    mediaType,
    title: String((mediaType === "movie" ? data.title : data.name) ?? ""),
    year: yearOf(mediaType === "movie" ? data.release_date : data.first_air_date),
    overview: typeof data.overview === "string" ? data.overview : "",
    genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre?.name).filter(Boolean) : [],
    runtimeMinutes: mediaType === "movie" && data.runtime > 0 ? data.runtime : null,
    seasons: mediaType === "tv" && data.number_of_seasons > 0 ? data.number_of_seasons : null,
    rating: typeof data.vote_average === "number" && data.vote_count > 0 ? Math.round(data.vote_average * 10) / 10 : null,
    posterUrl: image(data.poster_path, "w500"),
    backdropUrl: image(data.backdrop_path, "w1280"),
    trailerKey: trailer ? String(trailer.key) : null,
  };
}

/** GET /api/title/tt… : one title's details, cached at the edge for a day. */
export async function handleTitleRoute({ request, env, ctx, url }) {
  if (request.method !== "GET") return null;
  const match = url.pathname.match(/^\/api\/title\/(tt\d{1,10})$/);
  if (!match) return null;

  if (!env.TMDB_TOKEN) {
    return json({ error: "Title details are not set up on this site." }, { status: 503 });
  }

  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheKey = new Request(`${url.origin}/api/title/${match[1]}`);
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;

  let details;
  try {
    details = await getTitleDetails(env, match[1]);
  } catch {
    return json({ error: "Could not reach TMDB just now." }, { status: 502 });
  }

  const response = details
    ? json(details, { headers: { "cache-control": `public, max-age=${FOUND_CACHE_SECONDS}` } })
    : json({ error: "TMDB has no details for this title." }, {
        status: 404,
        headers: { "cache-control": `public, max-age=${MISSING_CACHE_SECONDS}` },
      });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
