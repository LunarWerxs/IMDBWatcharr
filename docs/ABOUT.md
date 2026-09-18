# IMDb Watcharr

> Turns a public IMDb watchlist into deterministic Radarr RSS and Sonarr JSON feed URLs, no account needed.

<!-- odin:about HAND-OWNED above the GENERATED marker. Edit freely; `odin codex about --ingest` carries it back into Odin's Codex. -->

## What it is

IMDb Watcharr is a free hosted web tool that turns a public IMDb watchlist or list URL into two deterministic feed URLs: a Radarr RSS feed for movies and a Sonarr custom-list JSON feed for TV, so both apps can pick up whatever a person already tracks on IMDb. Anyone can generate the two URLs with no account, and both keep working off the snapshot they were built from. Signing in with LunarWerx's own Connections identity provider claims the feed and puts it on a 15-minute auto-refresh schedule. Because IMDb rate-limits Cloudflare's own egress IPs, the actual IMDb fetching runs on a GitHub Actions runner, which posts snapshots back to the Cloudflare Worker over a shared-secret endpoint.

## Things not to forget

_The intricacies worth remembering: the gotchas, the half-built parts, the decisions whose
reason lives nowhere else. Odin never overwrites this section._

- IMDb rate-limits Cloudflare's own egress IPs, so the actual IMDb fetch runs from a GitHub Actions runner that posts snapshots back to the Worker, rather than the Worker fetching IMDb directly. anchors: `scripts/sync-feeds.mjs:34`
- The watchlist-id regex only accepts IMDb's two real id shapes on purpose; accepting anything looser previously let bogus /p/ URLs create feed rows for lists that cannot exist, which then failed every sync run forever. anchors: `src/imdb.js:1`
- Failure alerting only fires after FEED_ALERT_FAILURE_THRESHOLD (a bare constant of 3) consecutive sync failures rather than the first miss, so one transient IMDb hiccup does not notify anyone; there is no per-feed override. anchors: `src/imdb.js:19`
- Instant sync-on-paste is deliberately best-effort: requestSyncRun swallows a missing or rejected GITHUB_DISPATCH_TOKEN so a fresh paste can never fail feed creation, it just falls back to waiting for the next ~15-minute scheduled sync. anchors: `src/index.js:419`
- Sign-in-with-Connections hides itself entirely (503 'Sign in is not configured') when the OAuth env vars are absent, and the session only ever stores the opaque subject id, never profile data. anchors: `src/auth.js:129`
- npm run check only exercises src/imdb.js and src/imdb-graphql.js through recorded fixtures, not src/index.js, so a repeat of the 2026-09-04 backslash-corruption bug would not be caught before merge. anchors: `scripts/test-parser.mjs:4`
- The deploy-worker.yml CI job has been deliberately left red since 2026-08-18 (a revoked CLOUDFLARE_API_TOKEN) instead of being disabled, because a red job that reflects real breakage is treated as more honest than a green one that hides it; deploys are done by hand with npm run deploy until it is fixed. anchors: `docs/todo/TODO.md:42`
- A brand-new feed is not instant: its Radarr/Sonarr routes answer 503 until the sync job first populates that feed. anchors: `README.md:214`

<!-- odin:about GENERATED BEGIN - rewritten by `odin codex about --publish`; edit the Codex, not this -->

## What Odin knows about this project

Everything from here down is generated from this project's Codex dossier
(`codex/projects/imdbwatch.md` in the Odin clone) and is **rewritten on every publish** -
edit the dossier, not this block. Everything ABOVE the marker is yours.

### At a glance

- **Ships as:** web app - single Cloudflare Worker (wrangler deploy) serving both the API and a built React SPA; source on GitHub for self-hosting
- **Live at:** https://watcharr.lunarwerx.com
- **Written in:** TypeScript (22 files), JavaScript (11 files), SQL (5 files)
- **Built with:** Cloudflare Workers, React, Tailwind, TypeScript, Vite
- **Package:** `imdbwatch` 1.0.0
- **Entry points:** `scripts`, `workspaces`, `wrangler`
- **Tests:** 3 test file(s)
- **CI:** `ci.yml`, `deploy-worker.yml`, `sync-feeds.yml`
- **Deploys via:** cloudflare-workers
- **Domain:** radarr, sonarr, imdb, media-list-sync, watchlist, rss-feed-generation
- **Remote:** https://github.com/LunarWerxs/IMDBWatcharr.git

### Architecture

- `src/` - The Cloudflare Worker: routing (src/index.js), IMDb GraphQL client (src/imdb-graphql.js), feed/URL normalization and XML/JSON building (src/imdb.js), and Sign-in-with-Connections OAuth (src/auth.js).
- `web/` - Vite + React 19 + TypeScript SPA (Tailwind v4, shadcn/ui) that builds into web/dist/, served by the Worker's ASSETS binding.
- `migrations/` - Four versioned D1 schema migrations: feeds, feed items, TVDB id column, feed_owners join table.
- `scripts/` - sync-feeds.mjs (the GitHub Actions runner that fetches IMDb and posts snapshots), test-parser.mjs (fixture-based parser checks run by `npm run check`), make-og.mjs (build-time share-card rasterizer).
- `fixtures/` - Recorded IMDb GraphQL responses used by scripts/test-parser.mjs.
- `.github/workflows/` - ci.yml (parser checks, web lint, web build), deploy-worker.yml (wrangler deploy, currently red on a revoked token), sync-feeds.yml (cron + dispatch runner for scripts/sync-feeds.mjs).
- `docs/todo/` - NEXT.md - the two open owner-gated secrets left on this project.

### Features

19 recorded - 18 shipped, 1 partial, 0 planned. Each path is where the feature is DEFINED; the exact lines live in the Codex entry, which `odin codex check` re-verifies and repairs.

**Shipped**

- **Paste-a-list feed generation** _(free)_ - Paste a public IMDb watchlist or list URL and get back a Radarr RSS URL and a Sonarr custom-list URL, deterministically derived from the IMDb id so the same list always maps to the same URLs. - `src/index.js`, `web/src/App.tsx`
- **Radarr RSS feed** _(free)_ - Serves a Radarr-compatible RSS feed of the movies on a claimed or snapshotted IMDb list/watchlist. - `src/index.js`, `src/imdb.js`
- **Sonarr custom list feed** _(free)_ - Serves a Sonarr custom-list JSON payload of the TV titles on the list, matched to TVDB ids where possible. - `src/index.js`, `src/imdb.js`
- **TVDB id resolution** _(free)_ - Looks up each show's TVDB id via TVMaze so Sonarr can import it, carries resolved ids across syncs, and reports how many titles could not be matched. - `src/index.js`
- **Legacy/short URL redirects** _(free)_ - Old short-form /p/, /l/, /f/ links and .xml slug URLs 302-redirect to the current deterministic route, so a previously configured Radarr/Sonarr entry keeps working. - `src/index.js`
- **Sign in with Connections** _(free)_ - OAuth sign-in against LunarWerx's own AEGIS identity provider; a confidential client with a signed session cookie, storing only the opaque subject id (no profile data). Hides itself entirely if the OAuth secrets are not configured. - `src/auth.js`, `src/index.js`
- **Claim a feed to auto-refresh it** _(free)_ - Signing in and (re)pasting a list claims it into a feed_owners join table, which is what puts it on the 15-minute sync schedule; an unclaimed feed keeps working off its last snapshot and multiple people can claim the same public list without taking it from each other. - `src/index.js`
- **My feeds / unfollow** _(free)_ - A signed-in visitor sees an Unfollow button on each row of their claimed feeds; confirming stops auto-refreshing that feed via the existing /api/unfollow endpoint while its Radarr/Sonarr URLs keep serving the last synced snapshot, with a toast on success or failure. - `web/src/components/my-feeds.tsx`, `web/src/lib/api.ts`, `src/index.js`
- **Scheduled IMDb sync job** _(free)_ - A GitHub Actions workflow fetches every claimed feed's IMDb list roughly every 15 minutes (or on manual/repository dispatch) and posts the snapshot back to the Worker over a shared-secret endpoint, because Cloudflare's egress IPs are rate-limited by IMDb's own API. - `scripts/sync-feeds.mjs`, `src/index.js`
- **Stale feed refresh & failure reporting** _(free)_ - A poll to a stale, owned feed's route fires a background sync request while still serving the last good snapshot; a failed IMDb fetch on the runner is recorded on the feed and surfaced rather than left to age silently. - `src/index.js`
- **Snapshot fingerprinting / response caching** _(free)_ - Each synced snapshot is fingerprinted so an unchanged list re-serves the cached RSS/JSON body with an ETag instead of being rebuilt on every poll. - `src/index.js`, `src/imdb-graphql.js`
- **D1-backed feed storage** _(free)_ - Feed metadata, item snapshots, resolved TVDB ids, ownership, consecutive-failure counts, and cached Radarr/Sonarr bodies are stored in Cloudflare D1 across five versioned migrations. - `migrations/0001_initial.sql`, `src/index.js`
- **Paste & live-validate UI** _(free)_ - A Vite+React SPA where a pasted URL is validated live against IMDb's list/watchlist patterns before submitting, and results show item counts, feed status, and any Sonarr titles that could not be matched. - `web/src/App.tsx`, `web/src/lib/api.ts`
- **Copy-to-clipboard feed URLs** _(free)_ - Each returned Radarr and Sonarr URL has a one-click copy field. - `web/src/components/copy-field.tsx`
- **Theme toggle** _(free)_ - Light/dark theme toggle for the SPA. - `web/src/components/theme-toggle.tsx`
- **Anonymous privacy-respecting analytics** - An ARGUS pageview pixel and a first-party Studio visit ping, both honoring Do Not Track/GPC, skipping localhost, and never storing an IP address. - `web/src/lib/analytics.ts`
- **Share card generation** - A build-time script rasterizes a branded OG/share image for the site. - `scripts/make-og.mjs`
- **Feed sync health & repeated-failure alerts** _(free)_ - A signed-in visitor sees a "My feeds" card on the home page listing every claimed feed's status, item count, and last-synced time; a feed that fails FEED_ALERT_FAILURE_THRESHOLD (3) scheduled syncs in a row is flagged there and in a header bell badge backed by GET /api/notifications, instead of aging silently. In-app only - no outbound email path exists since the OAuth scopes never collect an address. Adapted from PostHog's Alerts and web-analytics live-view (MIT). - `web/src/components/my-feeds.tsx`, `web/src/components/notifications-badge.tsx`, `src/imdb.js`, `src/index.js`

**Partial - exists but incomplete, gated off, or known broken**

- **Instant sync on paste** _(free)_ - With an optional GitHub PAT configured, pasting a new list dispatches an immediate sync run instead of waiting for the next scheduled tick; the token is currently NOT set on the production Worker, so new lists degrade to the 15-minute schedule (see NEXT.md). - `src/index.js`

### Where to add a new one

- **a new Worker API route** - add a `request.method`/`url.pathname` check block inside the fetch handler, following the existing pattern. anchors: `src/index.js`
- **a new feed target beyond Radarr/Sonarr** - extend parseFeedRoute and the XML/JSON builders in src/imdb.js. anchors: `src/imdb.js`
- **a new D1 schema change** - add the next numbered file to migrations/ and apply with `npm run db:migrate:remote`. anchors: `migrations/0004_add_feed_owners.sql`
- **a new parser fixture/test case** - add a recorded response under fixtures/ and a case in scripts/test-parser.mjs, run with `npm run check`. anchors: `scripts/test-parser.mjs`
- **a new SPA UI element** - add a component under web/src/components/ (shadcn primitives in web/src/components/ui/) and wire it into App.tsx. anchors: `web/src/App.tsx`

### Gaps and wants

_Withheld: this repository is public, and the gap list is not published outside the private index._
_Read it with `python odin.py codex brief imdbwatch` in the Odin clone._

---

_Generated by `odin codex about --publish imdbwatch` on 2026-09-16 from a Codex dossier stamped 2026-09-14. Regenerate after the product moves; `odin codex about` reports drift._
<!-- odin:about GENERATED END sha=9f37f5e0c628 -->
