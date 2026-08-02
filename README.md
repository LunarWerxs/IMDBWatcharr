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
└── D1                    feed metadata, item snapshots, resolved TVDB ids,
                          and the cached Radarr XML / Sonarr JSON payloads
                                        ▲
                                        │ POST /api/ingest
GitHub Actions (sync-feeds.yml)         reads IMDb, pushes snapshots
```

**Why the fetching happens on a GitHub runner and not in the Worker.** IMDb refuses
Cloudflare's egress outright: `api.graphql.imdb.com` and `caching.graphql.imdb.com` both answer
`429 Too many network requests` to a Worker (0/20 attempts, on every header variant), and
`www.imdb.com/list/…` answers a `202` bot challenge. `imdb.com/robots.txt` returns `200` from the
same Worker, so it is not connectivity; it is a rate-limit rule against Cloudflare's shared Worker
egress IPs. A GitHub runner reaches the same API fine. So the runner fetches and the Worker stores.

- Data comes from [IMDb's own GraphQL API](https://api.graphql.imdb.com/): `list(id:"ls…")` for
  lists, `predefinedList(classType: WATCH_LIST, userId:"ur…")` for watchlists. A `p.…` profile id is
  translated to its `ur…` id through `userProfile(input:{profileId})` first.
- The Worker fingerprints the snapshot, so an unchanged list re-serves the cached body with an
  `ETag` instead of being rebuilt.
- If a sync fails, the routes keep serving the last good snapshot and the failure is recorded on the
  feed rather than left to age silently.
- TVDB ids come from TVMaze, looked up by the Worker (TVMaze is reachable from Cloudflare). Series
  with no mapping are left out of the Sonarr list, and resolved ids are carried across syncs.

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
| `GET /api/sync-targets`                       | Feeds the sync job should fetch (shared-secret auth)                 |
| `POST /api/ingest`                            | Store a snapshot the sync job fetched (shared-secret auth)           |

## The sync job

[sync-feeds.yml](.github/workflows/sync-feeds.yml) runs [scripts/sync-feeds.mjs](scripts/sync-feeds.mjs)
every 15 minutes, on manual dispatch, and on a `sync-feeds` repository dispatch. It reads the feed
list from the Worker, fetches each one from IMDb, and posts the snapshots back.

Both halves share `INGEST_SECRET` (a Worker secret and a repo secret); `WORKER_ORIGIN` is a repo
variable. Set the Worker's half with:

```bash
npx wrangler secret put INGEST_SECRET
```

Optionally give the Worker `GITHUB_DISPATCH_TOKEN` (a fine-grained PAT that may dispatch this repo)
and `GITHUB_REPOSITORY`. With them, pasting a new list asks the job to run immediately instead of
waiting for the next tick. Without them everything still works, just on the schedule.

Run a sync by hand from any machine that is not behind Cloudflare:

```bash
WORKER_ORIGIN=https://imdbwatcharr.blogitech3243.workers.dev INGEST_SECRET=... node scripts/sync-feeds.mjs
```

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

> ⚠️ The repo's `CLOUDFLARE_API_TOKEN` secret is **revoked** (verified 2026-08-02). The two deploy
> workflows fail in ~20s with `Invalid access token [code: 9109]` while `CI` and `Sync feeds` pass.
> A red deploy there is the token, not your commit. `Sync feeds` does not use that token, so the
> feeds keep updating regardless. Deploy manually until it is rotated.

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

- **A brand-new feed is not instant.** The Worker cannot fetch IMDb itself, so pasting a URL queues
  the list and the routes answer `503` until the sync job fills it. With `GITHUB_DISPATCH_TOKEN`
  configured that is under a minute; without it, up to the next scheduled run.
- **Scheduled runs drift.** GitHub delays `schedule` triggers under load, so 15 minutes is a floor
  rather than a clock.
- **IMDb's API carries a usage disclaimer** on every response: public, commercial, and non-private
  use of the data is not allowed. This is a personal, non-commercial tool feeding one household's
  Radarr and Sonarr, which is the lane that language leaves open.
