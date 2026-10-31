# Publishing Parakh on Cloudflare Pages

The app is a static site plus one small function for watchlist sync. It runs on
Cloudflare's free plan: Pages for the site, a D1 database for watchlists.

## How it updates

`.github/workflows/deploy.yml` runs after every successful data job (Daily
data, Collect filings, Import fundamentals), on pushes that change `web/` or
`pipeline/`, and by hand. It downloads the data release, recomputes ratios,
exports the JSON files into the app, builds it, and uploads it with
`wrangler pages deploy`. Only changed files are uploaded.

## One-time setup

1. Sign in from this folder: `cd web && npx wrangler login`
2. Create the database and table:
   `npx wrangler d1 create parakh` (put the printed `database_id` in `web/wrangler.toml`), then
   `npx wrangler d1 execute parakh --remote --file schema.sql`
3. Create the Pages project: `npx wrangler pages project create parakh --production-branch main`
4. Choose a sync key (a long passphrase) and store it as a secret:
   `npx wrangler pages secret put SYNC_KEY --project-name parakh`
5. In the Cloudflare dashboard, create an API token from the "Edit Cloudflare
   Workers" template (it covers Pages and D1). In GitHub → Settings → Secrets
   and variables → Actions, add secret `CLOUDFLARE_API_TOKEN` and variable
   `CLOUDFLARE_ACCOUNT_ID` (shown by `npx wrangler whoami`).
6. Run the "Deploy web app" workflow. The site is at https://parakh-49v.pages.dev
   (Cloudflare added "-49v" because "parakh" was taken; a custom domain can be added later).

On each device, open "Watchlists: This device only" at the bottom of the
sidebar and enter the sync key once.

## Free-plan limits that matter

| Limit | Ours |
|---|---|
| 20,000 files per deploy, 25 MB per file | ~5,700 files, largest ~3 MB |
| 100,000 function requests a day | a few hundred |
| D1: 5 GB, 100,000 writes a day | one row |
