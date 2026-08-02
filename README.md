# IMDb Watcharr

Turn a public IMDb watchlist or list into a **Radarr RSS feed** and a **Sonarr custom list**.

Live at [imdbwatcharr.pages.dev](https://imdbwatcharr.pages.dev).

1. Open the site
2. Paste a public IMDb watchlist or list URL
3. Copy the two URLs it gives back
4. Radarr `RSS List` gets the movie URL, Sonarr `Custom List` gets the TV URL

The URLs are derived from the IMDb identifier, so the same list always maps to the same URLs:

| IMDb source                                                  | Radarr                                                   | Sonarr                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| `imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/`       | `/radarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4`                  | `/sonarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4`                  |
| `imdb.com/list/ls006123300/`                                  | `/radarr/l/ls006123300`                                   | `/sonarr/l/ls006123300`                                   |

## Architecture

```
Cloudflare Pages (imdbwatcharr.pages.dev)
├── pages-static/          built React SPA, served from the edge
└── functions/[[path]].js  proxies only /api, /radarr, /sonarr, /p, /l, /f
                           to the Worker; everything else is a static asset
                                        │
                                        ▼
Cloudflare Worker (imdbwatcharr)        API + feed generation
├── D1                    feed metadata, item snapshots, resolved TVDB ids,
│                         and the cached Radarr XML / Sonarr JSON payloads
└── Browser Rendering     fallback when a direct IMDb fetch is challenged
```

- The Worker tries a plain IMDb fetch first and only falls back to Browser Rendering when that fails.
- It fingerprints the stable IMDb payload block rather than the whole page, so an unchanged list re-serves the cached body with an `ETag` instead of being rebuilt.
- If both fetch paths fail, the routes keep serving the last good snapshot.
- TVDB ids come from TVMaze. Series with no mapping are left out of the Sonarr list, and resolved ids are carried across syncs rather than re-looked-up.

## Web app

`web/` is a Vite + React 19 + TypeScript SPA styled with Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) (`radix-nova`, neutral base, Geist). It builds into `pages-proxy/pages-static/`.

```bash
npm install
npm run web:dev     # http://localhost:5173, API calls proxied to the live Worker
npm run web:build   # builds into pages-proxy/pages-static/
```

Point the dev proxy somewhere else with `VITE_API_ORIGIN=http://localhost:8787 npm run web:dev`.

Add a shadcn component with `npx shadcn@latest add <name>` from inside `web/`.

## Routes

| Route                                         | What it does                                                        |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `POST /api/create`                            | Normalize an IMDb URL, create/refresh the feed, return both URLs     |
| `GET /radarr/p/:profileId`                    | Radarr RSS for a watchlist                                           |
| `GET /radarr/l/:listId`                       | Radarr RSS for a list                                                |
| `GET /sonarr/p/:profileId`                    | Sonarr custom list JSON for a watchlist                              |
| `GET /sonarr/l/:listId`                       | Sonarr custom list JSON for a list                                   |
| `GET /{radarr,sonarr}/f/:imdbKey`             | Same, inferring the source from `ls…`, `p.…`, or `ur…`               |
| `GET /p/:id`, `/l/:id`, `/f/:id`              | Legacy shortcuts, redirect to `/radarr/…`                            |
| `GET /f/:slug.xml`                            | Legacy slug route, redirects to the deterministic path               |
| `GET /api/feeds/:slug`                        | Stored feed metadata                                                 |

## Local development

```bash
npm install
npm run check        # fixture-based parser checks
npm run web:build    # build the SPA
npm run dev          # wrangler dev --remote (Worker only)
```

Remote D1 migrations:

```bash
npm run db:migrate:remote
```

## Deployment

Pushing to `main` runs three workflows:

- [ci.yml](.github/workflows/ci.yml) parser checks, web lint, web build
- [deploy-worker.yml](.github/workflows/deploy-worker.yml) deploys the Worker
- [deploy-pages-proxy.yml](.github/workflows/deploy-pages-proxy.yml) builds the SPA and deploys Pages

Required repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Known limits

IMDb access is the hard part. IMDb frequently challenges datacenter traffic, so a refresh can fail even though the feeds keep working from the stored snapshot. The UI says so explicitly when that happens rather than pretending the sync succeeded.
