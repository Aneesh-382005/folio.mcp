# folio.mcp

Cloudflare Worker MCP server for portfolio, GitHub context, and the frontend site.

## What it does

- `get_profile` returns basic portfolio/contact links.
- `get_recent_work` returns recent public GitHub work from the last 12 months.
- `get_repo_detail` returns a selected repo in summary, standard, or deep mode.
- `send_message` sends a short contact email to Aneesh(with the current config) through Resend with IP rate limiting.

## Config

- Edit `src/config.ts` for profile links, GitHub username, and tool descriptions.
- Edit `src/tools.ts` if you want to change tool schemas or output text.
- Edit `src/contact-tools.ts` if you want to change the email format or rate limiter.
- Edit `src/github-client.ts` if you want to change GitHub fetching or caching.
- Edit `src/profile-client.ts` if you want to change static profile data.

## Frontend

- The static site lives in `frontend/`.
- The Worker serves the frontend and the MCP endpoint from the same hostname.
- The UI loads tool metadata from `GET /tools` on the same origin.

## Local dev

Create `.dev.vars` in the project root for local secrets:

```bash
GITHUB_TOKEN=your-token-here
RESEND_API_KEY=your-resend-api-key
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
wrangler secret put RESEND_API_KEY
```

Deploy the Worker and frontend together:

```bash
npm run deploy
```

GitHub Actions deploys the Worker on pushes to `main`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

No non-secret Worker vars are required.
