# folio.mcp

Cloudflare Workers MCP server for personal GitHub summaries.

## Config

- Edit `src/github-config.ts` to change your GitHub username.
- Edit `src/github-config.ts` to change tool titles and descriptions.

## Local dev

The current tool, `get_recent_work`, can use `GITHUB_TOKEN` for fuller org visibility, but it also works without it.

For seamless local dev, add your token to `.dev.vars` in the project root:

```bash
GITHUB_TOKEN=your-token-here
```

If you prefer, you can also export it in your shell for the current session only:

```bash
export GITHUB_TOKEN='your-token-here'
```

Cloudflare production uses `wrangler secret put GITHUB_TOKEN`.

## Deploy

Manual deploy:

```bash
npm run deploy
```

GitHub Actions deploys on pushes to `main` using `cloudflare/wrangler-action@v3`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

No non-secret Worker vars are required for the current setup.

## Notes

- The workflow runs `npm test` before deploy as a smoke check.
- The workflow also hits the deployed Worker root path after deploy as a health check.
- The Worker is deployed with Wrangler.
