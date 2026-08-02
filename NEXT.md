# What is next for IMDb Watcharr

Written 2026-08-02. Everything below is verified live, not inferred.

## The one real problem: the feeds have been frozen since April

`GET /radarr/l/ls006123300` returns `<lastBuildDate>Sat, 18 Apr 2026 07:01:31 GMT</lastBuildDate>`.
That snapshot is **3.5 months old**, and the live IMDb list now has **107 titles against the stored
100**. Radarr and Sonarr have been happily importing stale data the whole time.

The site does not look broken, which is why this went unnoticed. Every route still answers 200,
because the Worker deliberately falls back to the last good snapshot when a refresh fails. The UI
now says so out loud ("last good snapshot"), but the underlying refresh has simply never succeeded
again.

Both fetch paths are dead:

| Path                                        | What happens now                                                |
| ------------------------------------------- | --------------------------------------------------------------- |
| Direct `fetch()` of the IMDb page            | IMDb answers with a bot challenge, not list data                 |
| Browser Rendering fallback (`env.BROWSER`)   | `Unable to create new browser: code: 429: Rate limit exceeded`   |

The 429 is the free Browser Rendering allowance. Even paying for it only buys headroom on a scraping
approach that IMDb is actively fighting, so raising the quota is a patch, not a fix.

## The fix: stop scraping, use IMDb's own GraphQL API

`https://api.graphql.imdb.com/` is public, needs no key, and answers the exact question this project
asks. Verified working 2026-08-02 from this machine:

```bash
curl -s -X POST 'https://api.graphql.imdb.com/' \
  -H 'content-type: application/json' \
  -H 'x-imdb-client-name: imdb-web-next' \
  -d '{"query":"query{list(id:\"ls006123300\"){name{originalText} titleListItemSearch(first:3){total edges{title{id titleText{text} titleType{id} releaseYear{year}}}}}}"}'
```

```json
{"data":{"list":{"name":{"originalText":"WATCHLIST"},"titleListItemSearch":{"total":107,
"edges":[{"title":{"id":"tt0423977","titleText":{"text":"Charlie Bartlett"},
"titleType":{"id":"movie"},"releaseYear":{"year":2007}}}, ...]}}}}
```

That is every field `parseImdbHtml` currently digs out of `__NEXT_DATA__`: imdb id, title, type,
year, and the total. No browser, no HTML, no challenge page.

Things already learned the hard way, so you do not repeat them:

- The `x-imdb-client-name` header is **required**. Without it the endpoint returns a bare nginx
  `403 Forbidden` with no JSON body.
- The edge field is `title`, not `listItem` and not `node`. `titleListItemSearch` returns
  `TitleListItemSearchEdge`, whose fields are `cursor`, `node` and `title`.
- **Introspection is open**, so stop guessing at the schema and ask it:
  `{"query":"query{__type(name:\"TitleListItemSearchEdge\"){fields{name type{name kind ofType{name}}}}}"}`

## The open question to answer first

The proven query covers `/list/lsXXXXXXX/`. **Watchlists (`/user/p.XXXX/watchlist/` and `ur…`) are
not yet proven** through GraphQL. Settle that before writing any code, because it decides the shape
of the change:

- If one query covers both, `fetchImdbHtmlDirect` + the whole Browser Rendering block in
  [src/index.js](src/index.js) collapse into a single `fetchImdbList(sourceKey, sourceKind)`.
- If watchlists need a different root field, the parser keeps two source paths but still loses the
  browser.

Introspect `Query` for the watchlist-shaped root field, or check what a logged-out
`imdb.com/user/p.…/watchlist/` page posts to the same endpoint.

## What lands once it works

- `parseImdbHtml` / `extractImdbFingerprintPayload` in [src/imdb.js](src/imdb.js) stop parsing HTML
  and take the GraphQL payload. The JSON-LD fallback and the challenge-detection regex both go.
- Drop the `@cloudflare/playwright` dependency and the `browser` binding in [wrangler.toml](wrangler.toml).
  The Worker bundle goes from **3.1 MB to roughly 20 KB**, and Worker startup drops with it.
- `BROWSER_ATTEMPTS`, the retry/sleep loop, and the 429 backoff in `syncFeed` all delete.
- Keep the fingerprint + `ETag` caching exactly as is. It works, and it is what makes an unchanged
  list cheap.
- The fixtures in `fixtures/` and `scripts/test-parser.mjs` need GraphQL-shaped replacements.

## Before you ship it

Read the disclaimer the API returns on every response:

> Public, commercial, and/or non-private use of the IMDb data provided by this API is not allowed.

This is a personal, non-commercial tool feeding one household's Radarr and Sonarr, which is the lane
that language leaves open. It is Michael's call, and it should be a deliberate one rather than
something discovered later. The current HTML scraping is not on firmer ground.

## Smaller, unrelated

- **`CLOUDFLARE_API_TOKEN` in the repo secrets is revoked.** Both deploy workflows fail in ~20s with
  `Invalid access token [code: 9109]` while `CI` passes. Owner work, a 2 minute rotation. Until then
  deploy per the Deployment section of [README.md](README.md), which is proven and takes both halves
  through the Connections MCP vault.
