import { Hono } from "hono";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

const mcpServer = new McpServer({
	name: 'folio-mcp',
	version: '0.0.0',
});

const app = new Hono();

app.get('/', (c) => c.json({ status: 'ok' }));

app.all('/mcp', async (c) => {
	const transport = new WebStandardStreamableHTTPServerTransport();
	await mcpServer.connect(transport);
	return transport.handleRequest(c.req.raw);
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
