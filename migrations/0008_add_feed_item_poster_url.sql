-- WHY: the page shows a list's titles as posters, and a grey tile per title read
-- as bland (owner, 2026-09-27: "no pictures appear whatsoever"). The sync job
-- already asks IMDb for every title; this keeps the cover URL IMDb returns with
-- it. Only IMDb's own image host is stored (src/imdb.js imdbPosterUrl).
ALTER TABLE feed_items ADD COLUMN poster_url TEXT;
