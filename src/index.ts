import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerGitHubTools } from './github-tools';

type Env = {
  GITHUB_USER: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.json({ status: 'ok' }));

app.all('/mcp', async (c) => {
  const server = new McpServer({ name: 'folio-mcp', version: '0.0.0' });

  const GITHUB_USER = c.env.GITHUB_USER || 'Aneesh-382005';

  registerGitHubTools(server, GITHUB_USER);

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
