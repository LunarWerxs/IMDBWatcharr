# What is next for IMDb Watcharr

Updated 2026-08-02. Everything below is verified live, not inferred.

## The April freeze is over

The feeds were stuck on a 2026-04-18 snapshot for three and a half months. They are current now:
`/radarr/l/ls006123300` serves 72 movies and `/sonarr/l/ls006123300` serves 31 series, off a live
107-title list, with today's `lastBuildDate`.

Two things changed.

**Scraping is gone.** The parser reads [IMDb's own GraphQL API](https://api.graphql.imdb.com/)
instead of `__NEXT_DATA__` out of an HTML page. `@cloudflare/playwright` and the `BROWSER` binding
are deleted; the Worker bundle went from **3.1 MB to 29.6 KB** and starts in ~5 ms.

**The fetching moved off Cloudflare.** This is the part the previous write-up got wrong, and it is
worth stating plainly because it is not obvious and it cost a deploy to discover:

> IMDb refuses Cloudflare's egress. `api.graphql.imdb.com` and `caching.graphql.imdb.com` both
> answer `429 Too many network requests` to a Worker, on POST and GET, with or without the client
> header, **0 out of 20 attempts**. `www.imdb.com/list/…` answers a `202` challenge page. In the
> same Worker, `imdb.com/robots.txt` returns `200` and TVMaze returns `200`, so it is a rate-limit
> rule aimed at Cloudflare's shared Worker egress IPs, not a connectivity or header problem. A
> GitHub Actions runner reached the same API 5 times out of 5.

So [sync-feeds.yml](.github/workflows/sync-feeds.yml) fetches and `POST /api/ingest` stores. The
Worker still owns fingerprinting, caching, TVDB resolution, and every feed route.

## What is actually left

- **`CLOUDFLARE_API_TOKEN` in the repo secrets is still revoked.** Both deploy workflows fail in
  ~20s with `Invalid access token [code: 9109]`. Owner work, a 2 minute rotation. Deploys currently
  go through the local `wrangler` login, which works. `Sync feeds` does not touch that token, so the
  feeds keep updating either way.
- **`GITHUB_DISPATCH_TOKEN` is not set on the Worker.** Without it a newly pasted list waits for the
  next scheduled run instead of filling in under a minute. Everything degrades gracefully: the
  Worker just skips the dispatch. Needs a fine-grained PAT that can dispatch this repo, then
  `npx wrangler secret put GITHUB_DISPATCH_TOKEN` and `GITHUB_REPOSITORY`.
- **The SPA still talks about a fetch the Worker no longer does.** `web/src/App.tsx` says "IMDb did
  not answer this refresh" and "Feeds refresh at most every six hours". Both are now wrong in
  detail: the refresh is a scheduled job on a 15 minute floor, and a pending feed is queued rather
  than failed. The Worker already returns a `syncing` flag the UI could use to poll.

## Things learned the hard way, so you do not repeat them

- The `x-imdb-client-name` header is **required** on the GraphQL endpoint. Without it you get a bare
  nginx `403` with no JSON body.
- Full `__schema` introspection is **blocked** (`Unauthorized introspection request`), but
  `__type(name:"…")` still works, which is enough to walk the whole schema a type at a time.
- The edge field is `title`, not `listItem` and not `node`. `node` carries `absolutePosition` and
  `createdDate`; `title` carries the id, text, type and year.
- `titleListItemSearch` caps a page at **250** regardless of what `first` asks for. A 1000-title
  list returns 250 with `hasNextPage: true`, so cursor paging is mandatory, not optional.
- `after` on that field is a **`String`**, not an `ID`. Declaring the variable as `ID` fails
  validation.
- `predefinedList` only accepts a `ur…` id. A `p.…` profile id has to go through
  `userProfile(input:{profileId}){userId}` first, which costs one extra request.
- **IMDb lists really do contain duplicate titles** (`ls002448041` has 4). `feed_items` is keyed on
  `(feed_id, imdb_id)`, so a duplicate would fail the entire insert batch. The parser dedupes,
  keeping the first occurrence in `LIST_ORDER`.
- Junk feed rows reached production (`/p/profile-id`, `/p/<slug>.xml`, `ls123456789`) because the
  route patterns accepted any `[a-z0-9._-]+` as a watchlist key. They are deleted, and the patterns
  now only accept `p.<alnum>` or `ur<digits>`.

## Before you widen this beyond one household

Read the disclaimer the API returns on every response:

> Public, commercial, and/or non-private use of the IMDb data provided by this API is not allowed.

This is a personal, non-commercial tool feeding one household's Radarr and Sonarr, which is the lane
that language leaves open. It is Michael's call, and it should be a deliberate one rather than
something discovered later. The HTML scraping it replaced was not on firmer ground.
