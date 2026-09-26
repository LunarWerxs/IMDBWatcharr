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
- Deploys run from a machine signed in with wrangler (npm run deploy), like the other LunarWerx Cloudflare sites; GitHub holds no Cloudflare token and CI never deploys. Apply a new migration first (npm run db:migrate:remote): on 2026-09-26 migration 0005 had never reached the live database, so every sync write failed and 62 of 68 feeds sat pending from 2026-09-20. anchors: `README.md:191`
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
- **CI:** `ci.yml`, `sync-feeds.yml`
- **Deploys via:** cloudflare-workers
- **Domain:** radarr, sonarr, imdb, media-list-sync, watchlist, rss-feed-generation
- **Remote:** https://github.com/LunarWerxs/IMDBWatcharr.git

### Architecture

- `src/` - The Cloudflare Worker: routing (src/index.js), IMDb GraphQL client (src/imdb-graphql.js), feed/URL normalization and XML/JSON building (src/imdb.js), and Sign-in-with-Connections OAuth (src/auth.js).
- `web/` - Vite + React 19 + TypeScript SPA (Tailwind v4, shadcn/ui) that builds into web/dist/, served by the Worker's ASSETS binding.
- `migrations/` - Five versioned D1 schema migrations: feeds, feed items, TVDB id column, feed_owners join table, consecutive failure count.
- `scripts/` - sync-feeds.mjs (the GitHub Actions runner that fetches IMDb and posts snapshots), test-parser.mjs (fixture-based parser checks run by `npm run check`), make-og.mjs (build-time share-card rasterizer).
- `fixtures/` - Recorded IMDb GraphQL responses used by scripts/test-parser.mjs.
- `.github/workflows/` - ci.yml (parser checks, web lint, web build), sync-feeds.yml (cron + dispatch runner for scripts/sync-feeds.mjs).
- `docs/todo/` - NEXT.md - the two open owner-gated secrets left on this project.

### Features

25 recorded - 24 shipped, 1 partial, 0 planned. Each path is where the feature is DEFINED; the exact lines live in the Codex entry, which `odin codex check` re-verifies and repairs.

**Shipped**

- **Paste-a-list feed generation** _(free)_ - Paste a public IMDb watchlist or list URL and get back a Radarr RSS URL and a Sonarr custom-list URL derived from the IMDb id, so the same list always maps to the same URLs; a signed-out re-paste of a ready list can trigger a refresh at most every 5 minutes. - `src/index.js`, `web/src/App.tsx`
- **Radarr RSS feed** _(free)_ - Serves a Radarr-compatible RSS list of the movie and TV-movie titles on a snapshotted IMDb list/watchlist, from a cached body when one exists. - `src/index.js`, `src/imdb.js`
- **Sonarr custom list feed** _(free)_ - Serves a Sonarr custom-list JSON payload of the series and mini-series on the list, carrying only the titles matched to a TVDB id. - `src/index.js`, `src/imdb.js`
- **TVDB id resolution** _(free)_ - Looks up each show's TVDB id via TVMaze so Sonarr can import it, carries resolved ids across syncs, and reports how many titles could not be matched. - `src/index.js`
- **Legacy/short URL redirects** _(free)_ - Old short-form /p/, /l/, /f/ links and .xml slug URLs 302-redirect to the current deterministic route, and any alias hostname 301-redirects reads to the one canonical origin, so a previously configured Radarr/Sonarr entry keeps working. - `src/index.js`
- **Sign in with Connections** _(free)_ - OAuth sign-in against LunarWerx's own Connections (AEGIS) identity provider as a confidential client with a signed state cookie; the session is a stateless HMAC-signed cookie holding the subject id and display name shown in the header. Login answers 503 and the header control disappears when the OAuth secrets are not configured. - `src/auth.js`, `web/src/App.tsx`
- **Claim a feed to auto-refresh it** _(free)_ - Signing in and (re)pasting a list claims it into a feed_owners join table, which is what puts it on the 15-minute sync schedule; an unclaimed feed keeps working off its last snapshot, the result page nudges signed-out visitors to sign in, and several people can claim the same public list. - `src/index.js`, `web/src/App.tsx`
- **My feeds / unfollow** - A signed-in visitor sees an Unfollow button on each row of their claimed feeds; confirming stops auto-refreshing that feed while its Radarr/Sonarr URLs keep serving the last synced snapshot, with a toast on success or failure. - `web/src/components/my-feeds.tsx`, `web/src/lib/api.ts`, `src/index.js`
- **Scheduled IMDb sync job** - A GitHub Actions workflow reads the claimed feeds from the Worker every ~15 minutes (or on manual/repository dispatch), fetches each list from IMDb's GraphQL API and posts the snapshot or the error back over shared-secret endpoints, because IMDb refuses Cloudflare's egress. - `scripts/sync-feeds.mjs`, `src/index.js`
- **Stale feed refresh & failure reporting** _(free)_ - A poll to a stale, owned feed's route fires a background sync request while still serving the last good snapshot; a failed IMDb fetch on the runner is recorded on the feed and surfaced rather than left to age silently. - `src/index.js`
- **Snapshot fingerprinting / response caching** _(free)_ - Each synced snapshot is fingerprinted so an unchanged list re-serves the cached RSS/JSON body with an ETag instead of being rebuilt on every poll. - `src/index.js`, `src/imdb-graphql.js`
- **D1-backed feed storage** _(free)_ - Feed metadata, item snapshots, resolved TVDB ids, ownership, consecutive-failure counts, and cached Radarr/Sonarr bodies are stored in Cloudflare D1 across five versioned migrations. - `migrations/0001_initial.sql`, `src/index.js`
- **Paste & live-validate UI** _(free)_ - A Vite+React SPA where a pasted URL is validated live against IMDb's list/watchlist patterns, the result shows item counts, feed status and the number of unmatched Sonarr titles, and the page polls on its own while the first sync is still in flight. - `web/src/App.tsx`, `web/src/lib/api.ts`
- **Copy-to-clipboard feed URLs** _(free)_ - Each returned Radarr and Sonarr URL has a one-click copy field, on a card that names the exact Radarr/Sonarr settings path to paste it into. - `web/src/components/copy-field.tsx`, `web/src/App.tsx`
- **Theme toggle** _(free)_ - Light/dark theme toggle for the SPA. - `web/src/components/theme-toggle.tsx`
- **Anonymous privacy-respecting analytics** - An ARGUS pageview pixel and a first-party Studio visit ping, both honoring Do Not Track/GPC and skipping localhost. - `web/src/lib/analytics.ts`, `web/index.html`
- **Share card generation** - A build-time script rasterizes a branded OG/share image for the site. - `scripts/make-og.mjs`
- **Feed sync health & repeated-failure alerts** - A signed-in visitor's My feeds card lists each claimed feed's status, item count and last-synced time; a feed that fails FEED_ALERT_FAILURE_THRESHOLD (3) syncs in a row is flagged there and in a header bell badge backed by GET /api/notifications. In-app only, no email or webhook channel. - `web/src/components/my-feeds.tsx`, `web/src/components/notifications-badge.tsx`, `src/index.js`
- **Prerendered first paint** - The production build bakes the SPA's first view into web/dist/index.html, so the page paints from the HTML and stylesheet instead of after downloading and running the whole bundle; main.tsx detects the existing markup and hydrates it in place, and refuses to write an empty shell if the render produces no <main>. - `scripts/prerender-web.mjs`, `web/src/entry-prerender.tsx`, `web/src/main.tsx`
- **Immutable hashed-asset caching** - Vite-hashed files under /assets/ are served with a one-year immutable cache-control from the Worker, so a repeat visitor stops paying a conditional request per script, stylesheet and font; HTML is deliberately never marked immutable so the SPA fallback cannot pin a broken answer. - `src/index.js`
- **IME composition guard** - A document-level capture guard installed at boot swallows the keydown/keyup pair that belongs to a Chinese, Japanese or Korean input-method composition, so the Enter that commits a candidate never fires an application key handler on half-typed text. - `web/src/lib/ime-composition-guard.ts`, `web/src/main.tsx`
- **SEO metadata & no-JS content** - The HTML shell carries OpenGraph/Twitter meta, a canonical link and a JSON-LD graph (WebApplication, Organization, WebSite, FAQPage), plus a full noscript fallback that renders the product copy, comparison and FAQ so crawlers and JavaScript-less visitors get the content. - `web/index.html`
- **Agent-readable product brief & pricing** - Static pricing.md and llms-full.txt (with a short llms.txt) publish a machine-readable price (free, no paid tier, no payment integration) and the full product brief for agentic buyers and shopping/comparison agents. - `web/public/pricing.md`, `web/public/llms-full.txt`, `web/public/llms.txt`
- **Feed metadata API** _(free)_ - GET /api/feeds/<slug> returns a feed's stored record as JSON, or 404 for an unknown slug. - `src/index.js`

**Partial - exists but incomplete, gated off, or known broken**

- **Instant sync on paste** _(free)_ - With an optional GitHub token configured, pasting a list fires a repository_dispatch so the sync job runs at once instead of on the next tick; the token is NOT set on the production Worker, so new lists wait for the 15-minute schedule (docs/todo/TODO.md). - `src/index.js`

### Where to add a new one

- **a new Worker API route** - write a handle*Route({ request, env, ctx, url, publicOrigin }) that returns null for requests it does not own, add it to ROUTE_HANDLERS in the order it must be tried, and cover it in test/worker-routes.test.mjs anchors: `src/index.js`, `test/worker-routes.test.mjs`
- **a new feed target beyond Radarr/Sonarr** - extend parseFeedRoute and the XML/JSON builders in src/imdb.js. anchors: `src/imdb.js`
- **a new D1 schema change** - add the next numbered file to migrations/ and apply with `npm run db:migrate:remote`. anchors: `migrations/0004_add_feed_owners.sql`
- **a new parser fixture/test case** - add a recorded response under fixtures/ and a case in scripts/test-parser.mjs, run with `npm run check`. anchors: `scripts/test-parser.mjs`
- **a new SPA UI element** - add a component under web/src/components/ (shadcn primitives in web/src/components/ui/) and wire it into App.tsx. anchors: `web/src/App.tsx`

### Gaps and wants

_Withheld: this repository is public, and the gap list is not published outside the private index._
_Read it with `python odin.py codex brief imdbwatch` in the Odin clone._

---

_Generated by `odin codex about --publish imdbwatch` on 2026-09-26 from a Codex dossier stamped 2026-09-24. Regenerate after the product moves; `odin codex about` reports drift._
<!-- odin:about GENERATED END sha=a276c224039d -->
