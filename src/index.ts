import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from './tools';

type Env = {
  GITHUB_USER: string;
  GITHUB_TOKEN?: string;
  CACHE_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.json({ status: 'ok' }));

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

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
