/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ToolError, registerTool } from '../src/tool-result';

type Handler = (args: unknown) => Promise<{ content: Array<{ text: string }>; structuredContent?: unknown; isError?: boolean }>;

function fakeServer() {
  const handlers = new Map<string, Handler>();
  const server = { tool: (name: string, _description: string, ...rest: unknown[]) => handlers.set(name, rest.at(-1) as Handler) };
  return { server: server as never, handlers };
}

describe('registerTool', () => {
  it('builds content and structuredContent from the same data', async () => {
    const { server, handlers } = fakeServer();
    registerTool(server, 'greet', 'd', { name: z.string() }, ({ name }) => ({ hello: name, nested: { list: [1, null] } }));

    const result = await handlers.get('greet')!({ name: 'Ada' });

    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toEqual({ hello: 'Ada', nested: { list: [1, null] } });
  });

  it('turns a thrown ToolError into an error result and rethrows anything else', async () => {
    const { server, handlers } = fakeServer();
    registerTool(server, 'fails', 'd', () => { throw new ToolError('nope'); });
    registerTool(server, 'crashes', 'd', () => { throw new Error('bug'); });

    expect(await handlers.get('fails')!({})).toEqual({ isError: true, content: [{ type: 'text', text: 'nope' }] });
    await expect(handlers.get('crashes')!({})).rejects.toThrow('bug');
  });
});

describe('tool registration', () => {
  const sources = import.meta.glob('../src/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('registers every tool through registerTool, never server.tool directly', () => {
    const offenders = Object.entries(sources)
      .filter(([file, text]) => !file.endsWith('/tool-result.ts') && /\.(tool|registerTool)\(/.test(text))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
