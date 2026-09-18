# IMDb Watcharr - pricing

Machine-readable pricing summary for agentic buyers and shopping/comparison agents.

## Summary

| | |
|---|---|
| Product | IMDb Watcharr |
| Price | $0 (free) |
| Paid tier | None, no payment integration exists anywhere in the app |
| License | Source-available on GitHub (`github.com/LunarWerxs/IMDBWatcharr`); no formal OSI license file is published in the repository, so it is not certified "open source" in the OSI sense, but the code is publicly readable and free to self-host |
| Account required | No, for the base feature (creating and using a feed) |
| Account required for | Automatic feed refresh (~every 15 minutes), via optional sign-in with Connections |
| Self-hostable | Yes, Cloudflare Worker + D1 database + GitHub Actions sync job |
| Version | 1.0.0 |
| Intended use | Personal, non-commercial, single-household use |

## Hosted version (watcharr.lunarwerx.com)

- **$0.** Paste a public IMDb watchlist or list URL, get two working links back. No signup, no
  card, no trial period, no usage cap enforced by pricing.
- Optional sign-in with Connections (LunarWerx's own account system) is also free and only
  changes whether the feed is refreshed automatically.

## Self-hosted version

The software itself costs nothing. There is no license fee to run your own copy. Running it
does require your own accounts with third-party infrastructure the software depends on:

- **Cloudflare account** (Workers + D1 database) to host the Worker that serves the site and API.
  Cloudflare's own free tier is what LunarWerx uses for the hosted instance; any cost beyond that
  tier is Cloudflare's pricing, not IMDb Watcharr's.
- **GitHub account** to run the scheduled Actions job that fetches IMDb data (GitHub Actions has
  its own free minutes allowance for public repositories).
- **Connections OAuth credentials**, optional. Omit them and the site runs with sign-in hidden
  and no accounts at all.

## Bring-your-own-API-key costs

**None.** IMDb Watcharr does not call any metered, key-gated API that the user pays for directly:

- IMDb's own GraphQL API is called without a user-supplied API key (no key exists for it).
- TVMaze, used to resolve TVDB ids for Sonarr, is called without a user-supplied API key.
- There is no AI/LLM API call anywhere in this product, so there is no bring-your-own
  OpenAI/Anthropic/etc. key or per-token cost to account for.

## What's NOT included

- No premium tier, no usage-based billing, no ads-supported free tier with a paid upgrade.
- No guarantee of uptime or refresh cadence beyond what's documented in the README (scheduled
  GitHub Actions runs, which can drift under GitHub's own load).

## Fair use note

IMDb's own API terms carry a disclaimer forbidding public and commercial use of the data IMDb
Watcharr reads. The product is built and offered for personal, non-commercial, single-household
use in line with that language, not as a resale product or a public index.

---

Last updated: 2026-08-23. See [llms-full.txt](./llms-full.txt) for the complete product brief.
