import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("folio-mcp worker", () => {
	it("responds with status ok (unit style)", async () => {
		const request = new IncomingRequest("http://example.com");
		const response = await worker.fetch(
			request,
			env,
			{} as unknown as ExecutionContext
		);
		expect(await response.text()).toMatchInlineSnapshot(`"{\"status\":\"ok\"}"`);
	});

	it("responds with status ok (integration style)", async () => {
		const response = await worker.fetch(new Request("https://example.com"), env, {
		} as unknown as ExecutionContext);
		expect(await response.text()).toMatchInlineSnapshot(`"{\"status\":\"ok\"}"`);
	});
});
