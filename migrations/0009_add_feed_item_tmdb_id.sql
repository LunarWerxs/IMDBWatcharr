-- Radarr's own list type ("Radarr", which re-reads every 15 minutes rather than an RSS List's 12
-- hours) keys a movie on its TMDB id, which IMDb does not carry. It is looked up per movie and kept
-- here: NULL means not looked up yet, 0 means TMDB has no movie for that IMDb id.
ALTER TABLE feed_items ADD COLUMN tmdb_id INTEGER;
