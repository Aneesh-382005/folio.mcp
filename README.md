# folio.mcp

Cloudflare Workers MCP server for portfolio and GitHub context.

## What it does

- `get_profile` returns basic portfolio/contact links.
- `get_recent_work` returns recent public GitHub work from the last 12 months.
- `get_repo_detail` returns a selected repo in summary, standard, or deep mode.

## Config

- Edit `src/config.ts` for profile links, GitHub username, and tool descriptions.
- Edit `src/tools.ts` if you want to change tool schemas or output text.
- Edit `src/github-client.ts` if you want to change GitHub fetching or caching.
- Edit `src/profile-client.ts` if you want to change static profile data.

## Frontend

- The static site lives in `frontend/`.
- It loads tool metadata from `GET /tools` on the Worker.
- GitHub Actions deploys `frontend/` to Cloudflare Pages from `.github/workflows/deploy.yml`.
- In Cloudflare Pages, create or select a project named `folio-mcp-frontend`.

## Local dev

Create `.dev.vars` in the project root for local secrets:

```bash
GITHUB_TOKEN=your-token-here
```

You can also set it in your shell for one session:

```bash
export GITHUB_TOKEN='your-token-here'
```

Run locally with:

```bash
npm run dev
```

Call the worker:

```bash
curl -s -N -X POST http://127.0.0.1:8787/mcp \
	-H "Content-Type: application/json" \
	-H "Accept: application/json, text/event-stream" \
	-d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_recent_work","arguments":{}}}'
```

## Deploy

Set the production secret:

```bash
wrangler secret put GITHUB_TOKEN
```

Deploy the Worker:

```bash
npm run deploy
```

GitHub Actions also deploys the frontend to Cloudflare Pages on pushes to `main`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

No non-secret Worker vars are required.
