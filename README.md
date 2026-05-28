# folio.mcp

Cloudflare Workers MCP server for personal GitHub summaries.

## Config

- Edit `src/github-config.ts` to change your GitHub username.
- Edit `src/github-config.ts` to change tool titles and descriptions.

## Deploy

Manual deploy:

```bash
npm run deploy
```

GitHub Actions deploys on pushes to `main` using `cloudflare/wrangler-action@v3`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

No Worker vars are required for the current setup.

## Notes

- The workflow runs `npm test` before deploy as a smoke check.
- The workflow also hits the deployed Worker root path after deploy as a health check.
- The Worker is deployed with Wrangler.
