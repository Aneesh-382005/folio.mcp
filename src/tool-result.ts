import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type * as z from 'zod/v4';

export class ToolError extends Error {}

type Data = Record<string, unknown>;
type Shape = Record<string, z.ZodType>;

// Handlers return plain data and this builds both result fields from it, so
// `content` and `structuredContent` always carry the same thing.
export function registerTool(server: McpServer, name: string, description: string, handler: () => Data | Promise<Data>): void;
export function registerTool<S extends Shape>(
  server: McpServer,
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Data | Promise<Data>
): void;
export function registerTool(server: McpServer, name: string, description: string, ...rest: unknown[]): void {
  const handler = rest.pop() as (args: unknown) => Data | Promise<Data>;

  const callback = async (args: unknown) => {
    try {
      const data = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (err) {
      if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] };
      throw err;
    }
  };

  (server.tool as (...args: unknown[]) => unknown).call(server, name, description, ...rest, callback);
}
