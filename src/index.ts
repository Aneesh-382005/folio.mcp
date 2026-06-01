import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getToolCatalog, registerTools } from './tools';

type Env = {
  GITHUB_USER: string;
  GITHUB_TOKEN?: string;
  CACHE_KV: KVNamespace;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

const publicCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Cache-Control': 'public, max-age=300'
};

app.get('/tools', (c) =>
  c.json(
    {
      generated_at: new Date().toISOString(),
      tools: getToolCatalog()
    },
    200,
    publicCorsHeaders
  )
);

app.options('/tools', () => new Response(null, { status: 204, headers: publicCorsHeaders }));

app.all('/mcp', async (c) => {
  const server = new McpServer({ name: 'folio-mcp', version: '0.0.0' });

  registerTools(server, {
    githubUser: c.env.GITHUB_USER,
    githubToken: c.env.GITHUB_TOKEN,
    cacheKv: c.env.CACHE_KV
  });

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

app.get('*', (c) => {
  const assets = c.env?.ASSETS;

  if (assets && typeof assets.fetch === 'function') {
    return assets.fetch(c.req.raw);
  }

  return new Response(
    `<!doctype html>
<html>
  <head>
    <title>folio-mcp</title>
  </head>
  <body>
    folio-mcp
    <a href="/tools">/tools</a>
    <a href="/mcp">/mcp</a>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    }
  );
});

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
