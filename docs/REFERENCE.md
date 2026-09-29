# Watcharr reference

How Watcharr is built and run: the architecture, every route, the sync job, sign-in, analytics, local
development and deployment. What it does and how to set it up is in the [README](../README.md).

- [Architecture](#architecture)
- [Web app](#web-app)
- [Routes](#routes)
- [The sync job](#the-sync-job)
- [Analytics](#analytics)
- [Local development](#local-development)
- [Deployment](#deployment)

## Architecture

```
Cloudflare Worker (imdbwatcharr)   watcharr.lunarwerx.com
├── web/dist                  built React SPA, served through the ASSETS binding
├── D1                        feed metadata, item snapshots, resolved TVDB and TMDB ids,
│                             feed ownership, and the cached Radarr XML / Sonarr JSON
└── Sign in with Connections  AEGIS OAuth; a signed session cookie, no user data stored
                                        ▲
                                        │ POST /api/ingest
GitHub Actions (sync-feeds.yml)         reads IMDb, pushes snapshots
```

Every feed link also answers as a small Radarr or Sonarr v3 API (`{link}/api/v3/movie`, `/series` and
the list form's pickers, any API key), which is what lets Radarr's and Sonarr's own list types read it
every 15 and 5 minutes; the same link still serves RSS (Radarr) and custom-list JSON (Sonarr).

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
The runner reads three lists at a time and logs how long each read and ingest took.

- Data comes from [IMDb's own GraphQL API](https://api.graphql.imdb.com/): `list(id:"ls…")` for
  lists, `predefinedList(classType: WATCH_LIST, userId:"ur…")` for watchlists. A `p.…` profile id is
  translated to its `ur…` id through `userProfile(input:{profileId})` first.
- The Worker fingerprints the snapshot, so an unchanged list re-serves the cached body with an
  `ETag` instead of being rebuilt. A feed poll reads one row (the body it serves) and never the
  titles, and `If-None-Match` is compared weakly: Cloudflare turns the `ETag` into `W/"…"` whenever
  it compresses a body, which is every Radarr and Sonarr poll.
- An ingest works out the titles, their TVDB ids and both bodies first and writes them in one D1
  batch; a read of an unchanged list only looks at the shows still missing a TVDB id.
- If a sync fails, the routes keep serving the last good snapshot and the failure is recorded on the
  feed rather than left to age silently.
- TVDB ids come from TVMaze, then TMDB when TVMaze has no IMDb link for the show (TMDB needs
  `TMDB_TOKEN`), looked up by the Worker during an ingest (both are reachable from Cloudflare); a
  paste answers from what is stored and never waits on them. A show neither knows is not asked about
  again for a day. Series with no mapping are left out of the Sonarr list, and resolved ids are
  carried across syncs.
- Movies' TMDB ids come from TMDB's `/find` by IMDb id (needs `TMDB_TOKEN`), at most 250 per ingest;
  the runner then calls `POST /api/resolve-ids` until none are left or the count stops falling, and a
  Radarr poll of a list with movies still unresolved looks up the next batch after answering (at most
  every two minutes). A movie TMDB does not know is stored as 0 and served in the RSS answer only.

## Web app

`web/` is a Vite + React 19 + TypeScript SPA styled with Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com),
made to feel like IMDb: an off-black header and footer in both themes, a charcoal (or light) ground,
IMDb yellow for actions, and Roboto (self-hosted). It builds into `web/dist/`, which the Worker serves as its assets, and the
build prerenders the first view into `index.html` so the page paints before the JavaScript runs.
What nobody sees on arrival (the filled-in result, the title popup, the sign-in lightbox, the
signed-in library, the alert bell and the toasts) is split out with `lazyPart` (`web/src/lib/lazy.ts`) and fetched once
the page is idle, so the first download is the page itself and nothing waits on a click.

Signed out, one page, top to bottom:

- **The search bar.** Paste a list and press Generate, or click the example under it: one of six
  public lists, picked per visit, which fills the field and builds in one click. The six are
  pre-built on the live site so the first click is instant.
- **Your feeds.** The list's name, its counts on one line (the skipped count opens which shows
  Sonarr cannot take, and why), its status, a fan of its covers, and the two links, each with its
  open and Copy buttons inside the box. Under them, from tablet width up, the Add to Radarr /
  Sonarr sticker: a bookmark (`web/src/lib/arr-setup.js`) to drag to the bookmarks bar and click
  inside Radarr or Sonarr.
- **On this list.** The first covers; clicking one opens a popup with details from TMDB (backdrop,
  trailer, genres, plot, rating), View on IMDb, and a Request with Askarr step that swaps in place.
- **Questions.** The FAQ, from `web/src/lib/faq.ts`; the build writes the same entries into the
  page's FAQPage structured data.
- **Askarr**, LunarWerx's one-title request app, with its own logo and a drawn picture of it at work.

"Add another list" under the search bar says combining lists takes signing in; signed in, the
library starts a new feed with the link that was in the field and a second one to fill in.

### Signed in: the library

Signed in, the sales page is gone and the page is the library (`web/src/components/library.tsx`,
built from `web/src/components/feed-bits.tsx`). It shows one kind of thing, a feed: one Radarr link
and one Sonarr link, fed by one IMDb list or by several people's (`web/src/lib/use-feeds.ts`). The
feed picked fills the page: its cover, name and counts; on a computer the Add to Radarr / Sonarr
bookmark (`BookmarkSticker` in `web/src/components/one-click-setup.tsx`: drag it to the bookmarks bar,
click it inside Radarr or Sonarr) with the two copy buttons beside it, and on a phone, with no
bookmarks bar, the copy buttons alone; Share (people and the join link, in a window); a ⋯ for rename
(in place), delete, leave or stop following; its IMDb lists; and a strip of its covers that open the
title popup (`ScrollRow` in `web/src/components/scroll-row.tsx`, shared with the signed-out poster row:
arrows for a mouse, and a slim gold scrollbar only while it moves, drawn from the browser's own
scrollbar parts where it has them so Windows adds no step arrows). The feeds themselves are a rail of
covers down the side that stays in view as the page scrolls, so the feed is plainly what to work on:
it opens over the page under the pointer or the keyboard, the feed picked has a gold edge like the
phone's pills, and its pin keeps it open (`watcharr:feeds-pinned` in local storage). The rail clips
rather than hides its overflow: a hidden overflow is still a scroll box, and keyboard focus landing in
the folded rail used to scroll its covers out of sight. On a phone the feeds are a row of small pills.
The buttons wrap in pairs (the two copy buttons; Share with the ⋯), a copy button keeps its width
while it says Copied, and in light theme the grey buttons are white faces with an edge, since the
theme's grey is the page's own.

It shows what the moment needs and folds the rest away:

- No feeds yet: only the first-feed form, with three real lists to try.
- One feed: no side list; New feed sits at the far end of the buttons (beside the ⋯ on a phone).
- A feed just made opens with the Radarr and Sonarr setup showing; any other keeps it folded under
  "Where do these go in Radarr and Sonarr?" until a copy button is pressed. A feed just joined opens
  with its add-a-list field.
- The bookmark's line shows only while it is dragged, just dropped (for a few seconds) or clicked on
  the page, where it does nothing but say to drag it.
- An IMDb list is one line (whose, how big, a status dot) that opens for when it was read, what went
  wrong, Open on IMDb and Take it out. A list that cannot be read starts open, with the reason.
- Deleting, leaving, taking a list out, removing someone or making a new join link asks first, in
  the page's own window (`web/src/components/ask.tsx`), never the browser's.
- The header bell (`#needs-attention`) opens the first feed with a list that keeps failing, and
  reads its count again whenever the library changes a feed (`FEEDS_CHANGED` in
  `web/src/lib/feed-page.ts`), so taking a failing list out clears it.
- The header's LunarWerx and GitHub icons name themselves ("LunarWerx", "Self-host") in a small
  pop-up on hover or keyboard focus (`web/src/components/icon-tip.tsx`, CSS only, so the header adds
  nothing to the first download).
- A `?list=` link someone sent opens as a new feed waiting for a yes; the tab's last list does not
  come back, signed in.

Motion is one system: whole parts in half a second and small things in a quarter, on `--ease-soft`,
none of it under reduced motion. Parts fold open and shut (`fold` in `web/src/index.css`, which also
grows in a row that was just added), the side list's highlight slides to the feed picked, the picked
feed rises in part by part, covers fade in once loaded, and a feed being read breathes its dot. A
browser that was signed in last time (`watcharr:signed-in` in local storage, set from the session
read) shows the library's outline instead of the sales page until the session is read, so the pitch
never flashes up; `web/index.html` sets the class before anything draws.

Styling follows the Architect's shadcn rules: special buttons and the search field are variants in
`web/src/components/ui/` rather than restyled per use, colours are tokens in `web/src/index.css`,
and the only inline styles are CSS custom properties (`--delay` and friends, typed in
`web/src/css-properties.d.ts`) read by named utilities. `npm run og` redraws the share card and the
icons from their SVGs (the card's and the studio banner's sources sit in `web/art/`, not served).

```bash
npm install
npm run web:dev     # http://localhost:5173, API calls proxied to the live Worker
npm run web:build   # builds into web/dist/
```

Point the dev proxy somewhere else with `VITE_API_ORIGIN=http://localhost:8787 npm run web:dev`.

### The signed-in demo: `/?demo`

**To see the page as a signed-in person sees it, with no account, open
[watcharr.lunarwerx.com/?demo](https://watcharr.lunarwerx.com/?demo)** (or `/?demo` on any copy,
`npm run web:dev` included). It is signed in as Alex, a made-up person, with three lists of their own
(one failing, so the alert bell shows), a shared feed they made ("Our house", with Sam and Jordan and
a join link) and one they joined ("Movie night", made by Riley). Everything works: make feeds, add and
remove lists, rename, leave, delete, reset the join link; drop every feed to see the first-feed form,
and all but one to see a single feed. A list added in
the demo is "read" about twelve seconds later. **See an invite** in the demo banner opens the join
screen for a list Alex is not in yet (`/?demo&join=feedfacecafebeefdeadbeef00000001`), and the
sign-in prompts link to the demo as **See how it looks**.

How it works: `web/src/main.tsx` sees `?demo` (`web/src/lib/demo-mode.ts`) and, before the page
starts, loads `web/src/lib/demo.ts`, which puts itself in front of `window.fetch` and answers
`/api/me`, `/api/my-feeds`, `/api/notifications`, `/api/unfollow` and every `/api/shared` route from
memory; a reload starts over, and nothing reaches any account or the database. What anyone may read
without an account still comes from the live Worker: the example lists' real counts, a pasted list's
links and covers, a title's details, marked as the demo person's. Its answers are typed with
`web/src/lib/api.ts`'s own types, so an API change the demo does not follow fails `npm run web:build`.
The demo's shared-list links (`/radarr/s/de…`) are made up and answer 404. Visitors who never open
`?demo` never download it.

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
| `GET {any of those}/api/v3/movie`, `/series`  | The same list as a Radarr / Sonarr v3 API: movies by TMDB id, shows by TVDB id (any API key) |
| `GET {any of those}/api/v3/qualityprofile`, `rootfolder`, `tag`, `languageprofile` | The list form's pickers, one of each (`languageprofile` is Sonarr's) |
| `GET /p/:id`, `/l/:id`, `/f/:id`              | Legacy shortcuts, redirect to `/radarr/…`                            |
| `GET /f/:slug.xml`                            | Legacy slug route, redirects to the deterministic path               |
| `GET /api/feeds/:slug`                        | Where one feed stands, with its counts (read-only; the page polls it) |
| `GET /api/title/:imdbId`                      | One title's details from TMDB for the poster popup (cached a day; needs `TMDB_TOKEN`) |
| `GET /api/sync-targets`                       | The queue, then every claimed feed; `?scope=requested` for the queue only (shared-secret auth) |
| `POST /api/ingest`                            | Store a snapshot the sync job fetched (shared-secret auth)           |
| `POST /api/resolve-ids`                       | Look up a stored list's next 250 movies' TMDB ids (shared-secret auth); the runner calls it until none are left |
| `GET /auth/login`, `/auth/callback`, `/auth/logout` | Sign in with Connections                                        |
| `GET /api/me`, `/api/my-feeds`                | Session state and the feeds you have claimed, each with its sync health |
| `GET /api/notifications`                      | Just the feeds that have failed enough syncs in a row to need attention |
| `POST /api/unfollow`                          | Stop refreshing one of your feeds                                    |
| `GET /radarr/s/:slug`, `/sonarr/s/:slug`      | A shared list's Radarr RSS and Sonarr custom list: every IMDb list in it, each title once |
| `GET /{radarr,sonarr}/s/:slug/api/v3/…`       | The same shared list as a Radarr / Sonarr v3 API, pickers included    |
| `GET /api/shared`, `POST /api/shared`         | Your shared lists (with members, lists and counts); make one (`{ name }`) |
| `GET /api/shared/invite/:code`                | What a join link shows before joining: name, maker, size (no sign-in needed) |
| `POST /api/shared/join`                       | Join with a join link's code (`{ code }`)                             |
| `POST /api/shared/:slug/{sources,sources/remove,members/remove,invite,rename,delete}` | Add or remove an IMDb list, remove a person or leave, and the owner's new join link, rename and delete |
| anything else                                 | The page, with status `404`, so made-up URLs are not indexed as the home page |

## The sync job

[sync-feeds.yml](../.github/workflows/sync-feeds.yml) runs [scripts/sync-feeds.mjs](../scripts/sync-feeds.mjs)
every 15 minutes for every claimed feed (`scope: all`), every 5 minutes in between for the queue alone
(`scope: requested`, so a list just pasted is read within about five minutes), and on
`workflow_dispatch`. It asks the Worker
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
`npm run setup:dispatch` ([scripts/setup-dispatch-token.mjs](../scripts/setup-dispatch-token.mjs)) sets it
from any shell without the token ever being printed.

Optionally give it `TMDB_TOKEN` too, a [TMDB](https://www.themoviedb.org/settings/api) API read access
token (`wrangler secret put TMDB_TOKEN`). It gives each movie its TMDB id, which Radarr's own list
type needs (without it, use the Radarr link as an RSS List), and clicking a poster opens the title's details: plot,
genres, runtime, rating, a backdrop and the trailer, looked up by IMDb id through `GET /api/title/tt…`
and cached for a day. TMDB answers Cloudflare, which IMDb does not. Without it the popup shows the
title, year and cover the list already gave us.

Run a sync by hand from any machine that is not behind Cloudflare:

```bash
WORKER_ORIGIN=https://watcharr.lunarwerx.com INGEST_SECRET=... SYNC_SCOPE=all node scripts/sync-feeds.mjs
```

### Followed lists and sync alerts

The library lists every feed a signed-in visitor has claimed, each with its status, size and when it
was last read. A feed that fails `FEED_ALERT_FAILURE_THRESHOLD` (3) scheduled syncs in a row is
marked as needing attention there and in a small bell badge in the header, so a Radarr/Sonarr feed
going stale is noticed instead of discovered by accident. There is no outbound email today (the OAuth
scopes never request one), so this is in-app only: no separate mail service to configure.

A single list's ⋯ has Stop following (it asks first), which calls `POST /api/unfollow` to stop that
feed from auto-refreshing; its Radarr/Sonarr URLs keep serving the last synced snapshot, they just
stop updating.

### Shared lists

The page calls them shared feeds. A signed-in visitor can make a shared list ([src/shared-lists.js](../src/shared-lists.js), tables in
[migrations/0010_add_shared_lists.sql](../migrations/0010_add_shared_lists.sql)): one pair of links,
`/radarr/s/:slug` and `/sonarr/s/:slug`, fed by several IMDb lists. The maker hands out a join link
(`/?join=<code>`); anyone who opens it and signs in joins and adds their own lists. The links serve
the union of every list's titles, the first of each IMDb id (and, on the v3 API, of each TMDB or TVDB
id), in the order the lists were added.

- The slug is random and public; the join code is a separate 128-bit secret, so handing out the
  Radarr link never lets anybody in. The maker can make a new join link, which kills the old one.
- Anyone can take out the lists they added; the maker can take out any list, remove people (their
  lists go with them) and rename or delete it. A member who leaves takes their lists too.
- A feed in any shared list is on the 15-minute schedule like a claimed one (`readSyncTargets`), and
  adding a list new to the site dispatches a sync run.
- Limits: 10 shared lists per maker, 25 IMDb lists and 20 people per shared list.
- The page API never sends anyone's sign-in id; people show by the name Connections gave.

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
npm test             # every test, then the web lint
npm run web:build    # build the SPA
npm run dev          # wrangler dev --remote (Worker only)
```

Screenshots of every library interaction, for a visual check (375, 768 and 1280 wide, dark and light,
and reduced motion; headless, nothing opens on the desktop; each step's result, console errors and
failed requests land in `report*.json` beside them):

```bash
npm run web:dev
PLAYWRIGHT_CORE=<a playwright-core folder or package> node scripts/library-screens.mjs http://localhost:5173 shots
```

Playwright hides scrollbars unless told otherwise; the script keeps them, so a missing scrollbar in
its shots is real.

Remote D1 migrations:

```bash
npm run db:migrate:remote
```

## Deployment

Site and API ship together, to the Cloudflare account named by `account_id` in
[wrangler.toml](../wrangler.toml):

```bash
npm run deploy
```

That builds the SPA into `web/dist/` and runs `wrangler deploy`, which uploads the assets, the
Worker, and the `watcharr.lunarwerx.com` custom domain declared in [wrangler.toml](../wrangler.toml).

Deploys run from a machine signed in with `wrangler login`, the same way the other LunarWerx
Cloudflare sites ship; GitHub holds no Cloudflare token. When a change adds a file to
[migrations/](../migrations), apply it before deploying, because the live Worker reads the new
columns as soon as it ships:

```bash
CLOUDFLARE_ACCOUNT_ID=<your account id> npm run db:migrate:remote
npm run deploy
```

(`wrangler d1` ignores the `account_id` in wrangler.toml when a login sees several accounts, hence
the variable.)

Pushing to `main` runs:

- [ci.yml](../.github/workflows/ci.yml) parser checks, web lint, web build
- [sync-feeds.yml](../.github/workflows/sync-feeds.yml) keeps the claimed feeds current
