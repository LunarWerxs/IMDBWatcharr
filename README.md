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

> ⚠️ The repo's `CLOUDFLARE_API_TOKEN` secret is **revoked** (verified 2026-08-02). Both deploy
> workflows fail in ~20s with `Invalid access token [code: 9109]` while `CI` passes. A red deploy
> there is the token, not your commit. Deploy manually until it is rotated.

Cloudflare account: `eed9c6a3d77c18da26148d25e20ee951` (Blogitech@gmail.com).

**Worker, deployed through the Connections MCP vault.** This is the preferred path: the credential is
injected server-side, so it does not depend on whatever `wrangler login` session the machine happens
to hold, and every D1/Browser binding is inherited from the live Worker rather than re-declared.

```bash
npx wrangler deploy --dry-run --outdir .tmp-bundle
```

then `connections_execute { local: true, tool_name: "cloudflare_worker_deploy", params: { accountId: "eed9c6a3d77c18da26148d25e20ee951", scriptName: "imdbwatcharr", filePath: "<abs>/.tmp-bundle/index.js", mainModule: "index.js", instance: "default", dryRun: true } }`, check the inherited bindings, then re-run with `dryRun: false`.

**Pages, also through the vault.** There is no dedicated Pages tool, but `shell`'s `secrets` param
leases the Cloudflare credential into the child process env value-blind, so wrangler runs
authenticated without any `wrangler login` on the machine. Build first, then:

`connections_execute { local: true, tool_name: "shell", params: { command: "npx wrangler pages deploy pages-static --project-name imdbwatcharr --branch main --cwd pages-proxy", cwd: "<repo>", shell: "bash", secrets: [{ service: "cloudflare", as: "CLOUDFLARE_API_TOKEN" }], env: { CLOUDFLARE_ACCOUNT_ID: "eed9c6a3d77c18da26148d25e20ee951" } } }`

Note `shell`'s `instance` param is AWS-only and will not help here; `secrets` is the one that leases
a Cloudflare token. The lease is short (about 25 minutes), so re-run rather than reconnect if a long
upload outlives it.

Deploy **Pages before the Worker**: the SPA tolerates an older API shape, but the Worker's `/` is a
JSON API index, so a Worker-first order briefly serves JSON at `/`.

Once the token is rotated, pushing to `main` does all of this by itself:

- [ci.yml](.github/workflows/ci.yml) parser checks, web lint, web build
- [deploy-worker.yml](.github/workflows/deploy-worker.yml) deploys the Worker
- [deploy-pages-proxy.yml](.github/workflows/deploy-pages-proxy.yml) builds the SPA and deploys Pages

Required repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Known limits

⚠️ **The feeds are currently frozen on a 2026-04-18 snapshot.** IMDb challenges the direct fetch and
Browser Rendering answers `429 Rate limit exceeded`, so every refresh has failed since April while
the routes kept serving the last good snapshot. The UI says so explicitly rather than pretending the
sync succeeded, but the data is stale. The fix, with a proven browser-free replacement, is written up
in [NEXT.md](NEXT.md).
