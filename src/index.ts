import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { appConfig } from './config';
import { getToolCatalog, registerTools } from './tools';

type Env = {
  GITHUB_USER: string;
  GITHUB_TOKEN?: string;
  RESEND_API_KEY?: string;
  CACHE_KV: KVNamespace;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

// CORS: allow two production origins and any localhost port for local dev
app.use('*',
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (appConfig.cors.origins.includes(origin as (typeof appConfig.cors.origins)[number])) return origin;
      if (appConfig.cors.localhostOriginPattern.test(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept']
  })
);

app.get('/tools', (c) =>
  c.json({
    generated_at: new Date().toISOString(),
    tools: getToolCatalog()
  })
);

app.all('/mcp', async (c) => {
  const server = new McpServer({ name: 'folio-mcp', version: '0.0.0' });

  registerTools(server, {
    githubUser: c.env.GITHUB_USER,
    githubToken: c.env.GITHUB_TOKEN,
    cacheKv: c.env.CACHE_KV,
    resendApiKey: c.env.RESEND_API_KEY,
    request: c.req.raw
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
