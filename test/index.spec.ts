import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('folio-mcp worker', () => {
	it('serves the frontend shell at the site root', async () => {
		const request = new IncomingRequest('http://example.com');
		const response = await worker.fetch(request, env, {} as unknown as ExecutionContext);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(body).toContain('<!doctype html>');
		expect(body).toContain('folio-mcp');
		expect(body).toContain('/tools');
		expect(body).toContain('/mcp');
	});

	it('serves the frontend shell on arbitrary non-api paths', async () => {
		const response = await worker.fetch(new Request('https://example.com/docs'), env, {} as unknown as ExecutionContext);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(body).toContain('<!doctype html>');
		expect(body).toContain('folio-mcp');
	});
});