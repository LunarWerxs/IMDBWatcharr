# IMDb Watcharr

Turn a public IMDb watchlist or list into a **Radarr RSS feed** and a **Sonarr custom list**.

A [LunarWerx](https://lunarwerx.com) product, live at
[watcharr.lunarwerx.com](https://watcharr.lunarwerx.com).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join_the_community-5865F2?logo=discord&logoColor=white)](https://discord.gg/PsWpeNUzhk)

IMDb Watcharr is a free web tool that turns a public IMDb watchlist or list into a Radarr RSS feed
and a Sonarr custom list, so both apps can pick up the same movies and shows a person already
tracks on IMDb, refreshing on a schedule once the feed is claimed by signing in.

Anyone can build a feed without an account: both URLs come back at once, start serving titles as soon
as the list's first read from IMDb lands (usually within about fifteen minutes), and keep working
after that. Signing in with Connections, free, is what makes a list refresh on its own, about every
fifteen minutes.

## Quick start

1. Open the site
2. Paste a public IMDb watchlist or list URL
3. Copy the two URLs it gives back
4. Radarr `RSS List` gets the movie URL, Sonarr `Custom List` gets the TV URL

The URLs are derived from the IMDb identifier, so the same list always maps to the same URLs. Links
from the phone site (`m.imdb.com`) and IMDb's language paths (`imdb.com/de/list/…`) work too:

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

**Accounts decide what refreshes.** Every new feed is queued for one read from IMDb, whoever made
it, and then works forever off that snapshot; pasting the link again queues another read (at most
every five minutes). Claiming it by signing in is what puts it on the schedule, and ownership is a
join table rather than a column, so two people can keep the same public list alive without taking it
from each other.

**The queue.** `feeds.refresh_requested_at` is the sync job's to-do list. It is set when a list is
pasted (new, or pasted again) and cleared by the next successful read. `/api/sync-targets` hands the
runner claimed feeds with a pending request first, then signed-out requests (oldest first, at most 50
a run), then every other claimed feed, so however long the signed-out queue gets, no claimed feed is
left out. A private or missing list leaves the queue at once; any other failure leaves it after three
in a row and a full day of waiting, so an IMDb outage cannot empty the queue. A claimed feed stays on
the schedule regardless and recovers by itself once the list is public again. Only a paste creates a
feed: a Radarr or Sonarr URL for a list nobody has pasted answers `404` with instructions, so a
crawler cannot fill the queue. With `GITHUB_DISPATCH_TOKEN` set, a paste that newly queues a list asks
GitHub to run the job now, at most once a minute (`sync_dispatch`, migration 0007).

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
| `GET /api/feeds/:slug`                        | Where one feed stands, with its counts (read-only; the page polls it) |
| `GET /api/sync-targets`                       | The queue, then every claimed feed; `?scope=requested` for the queue only (shared-secret auth) |
| `POST /api/ingest`                            | Store a snapshot the sync job fetched (shared-secret auth)           |
| `GET /auth/login`, `/auth/callback`, `/auth/logout` | Sign in with Connections                                        |
| `GET /api/me`, `/api/my-feeds`                | Session state and the feeds you have claimed, each with its sync health |
| `GET /api/notifications`                      | Just the feeds that have failed enough syncs in a row to need attention |
| `POST /api/unfollow`                          | Stop refreshing one of your feeds                                    |

## The sync job

[sync-feeds.yml](.github/workflows/sync-feeds.yml) runs [scripts/sync-feeds.mjs](scripts/sync-feeds.mjs)
every 15 minutes and on `workflow_dispatch` (`scope: all` or `scope: requested`). It asks the Worker
what to read, fetches each list from IMDb, and posts the snapshots back. It stops starting new lists
after eight minutes, so a long queue is finished by the next run rather than killed mid-list.

Both halves share `INGEST_SECRET` (a Worker secret and a repo secret); `WORKER_ORIGIN` is a repo
variable. Set the Worker's half with:

```bash
npx wrangler secret put INGEST_SECRET
```

### Sign in with Connections

The Worker is a confidential OAuth client against AEGIS (`accounts.connectionsapi.com`), so the client
secret never reaches the browser and the SPA only ever sees a session cookie. It asks for `openid`
and `profile` only: the opaque subject is all it stores, hung on `feed_owners`.

`CONNECTIONS_CLIENT_ID` and `CONNECTIONS_ISSUER` live in `wrangler.toml`; `CONNECTIONS_CLIENT_SECRET`
and `SESSION_SECRET` are Worker secrets. With any of them missing the site simply hides the sign-in
button and behaves as it did before accounts existed.

Optionally give the Worker `GITHUB_DISPATCH_TOKEN`, a fine-grained PAT for this one repository with
only **Actions: Read and write** (`GITHUB_REPOSITORY` is already in `wrangler.toml`). With it, pasting
a new list dispatches `sync-feeds.yml` with `scope: requested`, so the list fills in about a minute
instead of on the next tick. Without it everything still works, just on the schedule.
[scripts/setup-dispatch-token.sh](scripts/setup-dispatch-token.sh) sets it without the token ever
being printed.

Run a sync by hand from any machine that is not behind Cloudflare:

```bash
WORKER_ORIGIN=https://watcharr.lunarwerx.com INGEST_SECRET=... SYNC_SCOPE=all node scripts/sync-feeds.mjs
```

### My feeds and sync alerts

A signed-in visitor sees a "My feeds" card on the home page listing every feed they have claimed,
each with its status, item count, and when it last synced. A feed that fails
`FEED_ALERT_FAILURE_THRESHOLD` (3) scheduled syncs in a row is marked as needing attention there and
in a small bell badge in the header, so a Radarr/Sonarr feed going stale is noticed instead of
discovered by accident. There is no outbound email today (the OAuth scopes never request one), so
this is in-app only: no separate mail service to configure.

Each row has an Unfollow button (with a confirm) that calls `POST /api/unfollow` to stop that feed
from auto-refreshing; its Radarr/Sonarr URLs keep serving the last synced snapshot, they just stop
updating.

## Analytics

The site carries two pieces of instrumentation, both owned by LunarWerx's own
Connections/Studio infrastructure rather than a third party.

**ARGUS pixel** (`web/index.html`), served from `analytics.connectionsapi.com`, gives page-view and
traffic-source analytics. It skips localhost.

**Studio visit ping** (`web/src/lib/analytics.ts`) fires once per browser session on page load:
a fire-and-forget `GET` to `studio.connectionsapi.com/v1/app/imdbwatch/latest`. What it sends:

- a random visitor id, generated client-side and kept in `localStorage` (not tied to any account)
- the app's build version
- the hostname (not the full URL) of `document.referrer`, only when one is present
- a `new=1` flag on the first-ever visit only

What the server derives from the request itself and stores: coarse geo (country, region, city,
timezone), the network ASN, locale, and a truncated user agent. It never stores an IP address.

The ping is skipped entirely when the page is loaded from localhost or a `.local` host. It never
blocks rendering, never retries, and a failed ping is swallowed silently.

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

Deploys run from a machine signed in with `wrangler login`, the same way the other LunarWerx
Cloudflare sites ship; GitHub holds no Cloudflare token. When a change adds a file to
[migrations/](migrations), apply it before deploying, because the live Worker reads the new
columns as soon as it ships:

```bash
CLOUDFLARE_ACCOUNT_ID=36d7c731fd0352ef08ea7e46d2d20793 npm run db:migrate:remote
npm run deploy
```

(`wrangler d1` ignores the `account_id` in wrangler.toml when a login sees several accounts, hence
the variable.)

Pushing to `main` runs:

- [ci.yml](.github/workflows/ci.yml) parser checks, web lint, web build
- [sync-feeds.yml](.github/workflows/sync-feeds.yml) keeps the claimed feeds current

## Known limits

- **A brand-new feed is not instant.** The Worker cannot fetch IMDb itself, so pasting a URL queues
  the list and the routes answer `503` (with `Retry-After: 900`) until the sync job fills it. With
  `GITHUB_DISPATCH_TOKEN` configured that is about a minute; without it, up to the next scheduled run.
  The page polls and updates by itself when the list lands.
- **Private lists cannot be read.** IMDb answers a private watchlist or list with a permission error;
  the page says so and asks the owner to make it public, then paste it again.
- **Scheduled runs drift.** GitHub delays `schedule` triggers under load, so 15 minutes is a floor
  rather than a clock.
- **IMDb's API carries a usage disclaimer** on every response: public, commercial, and non-private
  use of the data is not allowed. This is a personal, non-commercial tool feeding one household's
  Radarr and Sonarr, which is the lane that language leaves open.

## How it compares

- **Trakt-based bridges** (Radarr's own Trakt list support, or scripts like Traktarr): these
  route an IMDb list through a separate Trakt account, and often a self-hosted
  script that has to keep running, before Radarr or Sonarr ever see it. IMDb Watcharr reads IMDb's
  own API directly and hands back a Radarr feed and a Sonarr feed from the same URL, no Trakt
  account and no extra script to host.
- **mdblist.com**: a general-purpose list aggregator that can also take an IMDb list URL and hand
  Radarr or Sonarr something to import, alongside Trakt, Rotten Tomatoes, and other sources. IMDb
  Watcharr is narrower on purpose: it is built only around IMDb's own GraphQL API, and it is the
  one that also resolves each show to a TVDB id for Sonarr and reports how many titles it could
  not match.
- **Copying an IMDb list by hand**: works, but it is a one-time snapshot. IMDb Watcharr's two URLs
  stay pointed at the same IMDb list, and once a feed is claimed by signing in, the list behind it
  is checked again roughly every fifteen minutes.

## FAQ

**Is IMDb Watcharr free?**
IMDb Watcharr is free. Anyone can paste a public IMDb watchlist or list URL and get back a Radarr
feed and a Sonarr feed with no account and no payment. Signing in with Connections is also free;
it only changes how often the feed refreshes, moving it onto the fifteen-minute schedule instead
of its original snapshot.

**Do I need an account to use it?**
No. You get both links straight away, and they serve the list from its first read from IMDb, which
usually lands within about fifteen minutes. Signing in with Connections is optional and free; it
claims the feed and puts it on the automatic refresh schedule, so the underlying IMDb list is checked
again roughly every fifteen minutes instead of staying fixed on that first snapshot.

**Does it work offline?**
No, it is a hosted web service, not a local app: watcharr.lunarwerx.com does the IMDb fetching,
TVDB matching, and feed hosting, and Radarr or Sonarr must reach it over the network to read the
feed. The source code is on GitHub, so it can be self-hosted instead if a fully offline or private
deployment is needed.

**What are the system requirements?**
None on the reader's side. IMDb Watcharr is a website: open it in a browser, paste a public IMDb
watchlist or list URL, and copy the two links it returns into Radarr and Sonarr. All the fetching,
TVDB matching, and feed hosting runs on IMDb Watcharr's own Cloudflare Worker, not on the machine
running Radarr and Sonarr.

**How is it different from Trakt-based bridges like Traktarr?**
Tools like Traktarr, or Radarr's own Trakt list support, route an IMDb list through a separate
Trakt account, and often a self-hosted script, before Radarr or Sonarr ever see it. IMDb Watcharr
reads IMDb's own API directly and hands back a Radarr feed and a Sonarr feed from the same URL, no
Trakt account, no extra script to run.

**Is my data sent anywhere?**
No personal data is required to build a feed: it only needs a public IMDb URL. Signing in adds a
Connections session cookie and an opaque subject id used to claim ownership, nothing else.

**Why is a show missing from my Sonarr list?**
Sonarr needs a TVDB id for every show, and not every IMDb title resolves to one. Any show IMDb
Watcharr cannot match is left out of the Sonarr list rather than passed along broken, and the app
reports how many titles were skipped.

**Why does a list I just pasted return an error?**
A brand-new list is not instant: IMDb Watcharr's Worker cannot fetch IMDb directly, so a freshly
pasted URL is queued and both routes answer `503` until the sync job fills the list in, which happens
on the next scheduled sync, roughly every fifteen minutes. If it still fails after that, the list is
probably private on IMDb: the page says so, and making it public then pasting it again fixes it.

---

**Want to request a single title from your phone instead?** [Askarr](https://askarr.com), also by
LunarWerx, lets you search any movie or show from any browser and request it; the Askarr Monitor on
your Windows PC adds it to your own Radarr and Sonarr, so neither has to face the internet.

Made by [LunarWerx](https://lunarwerx.com), who also build [Askarr](https://askarr.com),
[RepoYeti](https://repoyeti.com), [SageThumbs](https://sagethumbs.lunarwerx.com), and
[QuickDictate](https://quickdictate.lunarwerx.com).
