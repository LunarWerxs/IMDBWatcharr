# What is next for IMDb Watcharr

Updated 2026-08-28. Two owner-gated secrets are the only open work left here. Everything that used
to live in this file (the April freeze, the GraphQL migration, the move off Cloudflare for fetching)
shipped and is now described in [README.md](../../README.md) instead.

## `GITHUB_DISPATCH_TOKEN` is not set on the Worker

Without it, pasting a new list waits for the next scheduled `sync-feeds` run instead of filling in
under a minute. The Worker just skips the dispatch and degrades cleanly, so this is optional, not
broken.

Needs a fine-grained GitHub PAT that can dispatch this repo, then:

    npx wrangler secret put GITHUB_DISPATCH_TOKEN
    npx wrangler secret put GITHUB_REPOSITORY

## `CLOUDFLARE_API_TOKEN` in the repo secrets is revoked

[`Deploy Worker`](../../.github/workflows/deploy-worker.yml) fails red on every push with
`Authentication error [code: 10000]` then `Invalid access token [code: 9109]`, and has since
2026-08-18. `CI`, `Sync feeds`, and the egress probe are green and never touch that token, so the
repo looks healthy at a glance and is not. The red is honest and worth leaving red: the credential is
present and invalid, which is a real breakage.

Needs a fresh Cloudflare API token for account `36d7c731fd0352ef08ea7e46d2d20793` (Lunawerx@gmail.com,
the account that also holds the `lunarwerx.com` zone), set as the `CLOUDFLARE_API_TOKEN` GitHub
Actions repo secret. The deploy job resumes on its own the moment a working token is in place, no
code change needed.

Until then the site still ships by hand: see README's Deployment section for the `npm run deploy`
path, including running it through the Connections MCP's vaulted Cloudflare credential so the token
never has to reach a local machine.
