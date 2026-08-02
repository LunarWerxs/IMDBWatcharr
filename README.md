# IMDb Watcharr

Turn a public IMDb watchlist or list into a **Radarr RSS feed** and a **Sonarr custom list**.

A [LunarWerx](https://lunarwerx.com) product, live at
[watcharr.lunarwerx.com](https://watcharr.lunarwerx.com).

Anyone can build a feed without an account: both URLs work immediately and keep working. Signing in
with Connections is what makes a list refresh on its own, about every fifteen minutes.

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
Cloudflare Worker (imdbwatcharr)   watcharr.lunarwerx.com
├── web/dist                  built React SPA, served through the ASSETS binding
├── D1                        feed metadata, item snapshots, resolved TVDB ids,
│                             feed ownership, and the cached Radarr XML / Sonarr JSON
└── Sign in with Connections  AEGIS OAuth; a signed session cookie, no user data stored
                                        ▲
                                        │ POST /api/ingest
GitHub Actions (sync-feeds.yml)         reads IMDb, pushes snapshots
```

One Worker serves both the site and the API: it runs first on every request and hands anything it
does not answer to the static assets, so there is no proxy in front of the API and a deploy is one
command.

**Accounts decide what refreshes.** A feed anyone creates works forever off the snapshot it was
built from. Claiming it by signing in is what puts it on the schedule, and ownership is a join
table rather than a column, so two people can keep the same public list alive without taking it
from each other.

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

`web/` is a Vite + React 19 + TypeScript SPA styled with Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com),
themed to the LunarWerx house palette: slate-950 ground, white type, red accent, Orbitron for display
and Inter for everything else. It builds into `web/dist/`, which the Worker serves as its assets.

```bash
npm install
npm run web:dev     # http://localhost:5173, API calls proxied to the live Worker
npm run web:build   # builds into web/dist/
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
| `GET /auth/login`, `/auth/callback`, `/auth/logout` | Sign in with Connections                                        |
| `GET /api/me`, `/api/my-feeds`                | Session state and the feeds you have claimed                         |
| `POST /api/unfollow`                          | Stop refreshing one of your feeds                                    |

## The sync job

[sync-feeds.yml](.github/workflows/sync-feeds.yml) runs [scripts/sync-feeds.mjs](scripts/sync-feeds.mjs)
every 15 minutes, on manual dispatch, and on a `sync-feeds` repository dispatch. It reads the feed
list from the Worker, fetches each one from IMDb, and posts the snapshots back.

Both halves share `INGEST_SECRET` (a Worker secret and a repo secret); `WORKER_ORIGIN` is a repo
variable. Set the Worker's half with:

```bash
npx wrangler secret put INGEST_SECRET
```

### Sign in with Connections

The Worker is a confidential OAuth client against AEGIS (`accounts.connections.icu`), so the client
secret never reaches the browser and the SPA only ever sees a session cookie. It asks for `openid`
and `profile` only: the opaque subject is all it stores, hung on `feed_owners`.

`CONNECTIONS_CLIENT_ID` and `CONNECTIONS_ISSUER` live in `wrangler.toml`; `CONNECTIONS_CLIENT_SECRET`
and `SESSION_SECRET` are Worker secrets. With any of them missing the site simply hides the sign-in
button and behaves as it did before accounts existed.

Optionally give the Worker `GITHUB_DISPATCH_TOKEN` (a fine-grained PAT that may dispatch this repo)
and `GITHUB_REPOSITORY`. With them, pasting a new list asks the job to run immediately instead of
waiting for the next tick. Without them everything still works, just on the schedule.

Run a sync by hand from any machine that is not behind Cloudflare:

```bash
WORKER_ORIGIN=https://watcharr.lunarwerx.com INGEST_SECRET=... node scripts/sync-feeds.mjs
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

Cloudflare account: `36d7c731fd0352ef08ea7e46d2d20793` (Lunawerx@gmail.com), the same account that
holds the `lunarwerx.com` zone. Site and API ship together:

```bash
npm run deploy
```

That builds the SPA into `web/dist/` and runs `wrangler deploy`, which uploads the assets, the
Worker, and the `watcharr.lunarwerx.com` custom domain declared in [wrangler.toml](wrangler.toml).

> ⚠️ The repo's `CLOUDFLARE_API_TOKEN` secret is **revoked** (verified 2026-08-02) and it belonged
> to the old account anyway. [deploy-worker.yml](.github/workflows/deploy-worker.yml) verifies the
> token, skips with a warning annotation, and stays green; it starts deploying again once a token
> for the Lunawerx account is in place. Until then deploy with the command above.

Pushing to `main` runs:

- [ci.yml](.github/workflows/ci.yml) parser checks, web lint, web build
- [deploy-worker.yml](.github/workflows/deploy-worker.yml) deploys the Worker when a token works
- [sync-feeds.yml](.github/workflows/sync-feeds.yml) keeps the claimed feeds current

## Known limits

- **A brand-new feed is not instant.** The Worker cannot fetch IMDb itself, so pasting a URL queues
  the list and the routes answer `503` until the sync job fills it. With `GITHUB_DISPATCH_TOKEN`
  configured that is under a minute; without it, up to the next scheduled run.
- **Scheduled runs drift.** GitHub delays `schedule` triggers under load, so 15 minutes is a floor
  rather than a clock.
- **IMDb's API carries a usage disclaimer** on every response: public, commercial, and non-private
  use of the data is not allowed. This is a personal, non-commercial tool feeding one household's
  Radarr and Sonarr, which is the lane that language leaves open.
