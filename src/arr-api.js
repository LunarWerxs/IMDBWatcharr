// Radarr's and Sonarr's own list types ("Radarr" and "Sonarr", which import
// from another Radarr or Sonarr) are re-read every 15 and 5 minutes, where an
// RSS List waits 12 hours and a Custom List 6 (read off Radarr 6.4 and Sonarr
// 4.0). So each feed link, a single list's or a shared list's, also answers as
// a small Radarr or Sonarr v3 API: the same link is the list's Full URL, and
// the app asks {link}/api/v3/movie (or series) plus the pickers its list form
// fills in. The lists are public, so any API key will do. The shapes follow
// Askarr's, the studio's other product, which proved them against a real
// Radarr and Sonarr.

const ARR_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
};

// The list form's pickers: one of each, so a filter set in the app can only
// ever match everything. Radarr has no language profiles.
const ARR_PICKERS = {
  radarr: { qualityprofile: [{ id: 1, name: "Watcharr" }], rootfolder: [{ id: 1, path: "/watcharr" }], tag: [] },
  sonarr: {
    qualityprofile: [{ id: 1, name: "Watcharr" }],
    languageprofile: [{ id: 1, name: "Any" }],
    rootfolder: [{ id: 1, path: "/watcharr" }],
    tag: [],
  },
};

export function arrJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: ARR_HEADERS });
}

/**
 * What the app asked a link's v3 API for: a picker (answered here, the same
 * for every list) or the list itself, which the caller reads. `response` is
 * set when this answers it.
 */
export function arrListRequest(feedTarget, resourceName) {
  const resource = resourceName.toLowerCase();
  const pickers = ARR_PICKERS[feedTarget];
  if (Object.hasOwn(pickers, resource)) {
    return { response: arrJson(pickers[resource]) };
  }
  if (resource !== (feedTarget === "radarr" ? "movie" : "series")) {
    return { response: arrJson({ message: "NotFound" }, 404) };
  }
  return {};
}

/** The apps only show the slug; a title with no Latin letters or digits still gets one. */
function arrSlug(title, id) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || String(id);
}

// Radarr reads TmdbId, Title and Year; its list filters read QualityProfileId,
// Tags and Path. InCinemas and PhysicalRelease are non-nullable dates in
// Radarr, so they are left out, not null.
const toRadarrMovie = (row) => ({
  title: row.title,
  sortTitle: row.title.toLowerCase(),
  tmdbId: row.id,
  overview: "",
  images: [],
  monitored: true,
  year: row.year ?? 0,
  titleSlug: arrSlug(row.title, row.id),
  qualityProfileId: 1,
  path: "/watcharr",
  tags: [],
});

// Sonarr reads TvdbId and Title; its filters read the two profile ids, Tags and
// RootFolderPath. Seasons only matter with "sync season monitoring" on; empty
// means Sonarr's own defaults.
const toSonarrSeries = (row) => ({
  title: row.title,
  sortTitle: row.title.toLowerCase(),
  tvdbId: row.id,
  overview: "",
  images: [],
  monitored: true,
  year: row.year ?? 0,
  titleSlug: arrSlug(row.title, row.id),
  qualityProfileId: 1,
  languageProfileId: 1,
  rootFolderPath: "/watcharr",
  seasons: [],
  tags: [],
});

/** The list itself, as the app reads it: rows of { id, title, year }, the id TMDB's or TVDB's. */
export function arrListResponse(feedTarget, rows) {
  return arrJson(rows.map(feedTarget === "radarr" ? toRadarrMovie : toSonarrSeries));
}
