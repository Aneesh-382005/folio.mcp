import { describe, expect, it, vi } from 'vitest';
import { sendMessageViaResend } from '../src/contact-tools.js';

type StoredValue = {
  value: string;
  expiration?: number;
};

class MockKv {
  private store = new Map<string, StoredValue>();

  async get(key: string, type?: 'json') {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration <= Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }

    if (type === 'json') {
      return JSON.parse(entry.value);
    }

    return entry.value;
  }

  async put(key: string, value: string, options?: { expiration?: number }) {
    this.store.set(key, { value, expiration: options?.expiration });
  }
}

describe('sendMessageViaResend', () => {
  it('sends a formatted email and returns a success result', async () => {
    const cacheKv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 })
    );
    const request = new Request('https://example.com/mcp', {
      headers: {
        'cf-connecting-ip': '203.0.113.10'
      }
    });

    const result = await sendMessageViaResend(
      {
        sender_name: 'Jordan Lee',
        message: 'I would like to talk about a systems project.',
        context: 'Open to a quick collaboration chat next week.',
        reply_to_email: 'jordan@example.com'
      },
      {
        cacheKv,
        resendApiKey: 'test-key',
        request,
        fetchFn
      }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Message sent to Aneesh from Jordan Lee.');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const firstCall = fetchFn.mock.calls[0];
    const requestInit = firstCall?.[1];
    expect(requestInit).toBeDefined();
    if (!requestInit) throw new Error('request init missing');

    expect(requestInit.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json'
    });

    const body = JSON.parse(String(requestInit.body));
    expect(body.from).toContain('onboarding@resend.dev');
    expect(body.to).toEqual(['aneesh.grover03@gmail.com']);
    expect(body.reply_to).toBe('jordan@example.com');
    expect(body.text).toContain('From: Jordan Lee');
    expect(body.text).toContain('Reply-to email: jordan@example.com');
    expect(body.text).toContain('Sent via folio.mcp.');
    expect(body.html).toContain('Open to a quick collaboration chat next week.');
    expect(body.html).toContain('jordan@example.com');
  });

  it('does not include reply_to when optional email is omitted', async () => {
    const cacheKv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 'email_124' }), { status: 200 })
    );
    const request = new Request('https://example.com/mcp', {
      headers: {
        'cf-connecting-ip': '203.0.113.12'
      }
    });

    const result = await sendMessageViaResend(
      {
        sender_name: 'No Reply User',
        message: 'No email provided intentionally.'
      },
      {
        cacheKv,
        resendApiKey: 'test-key',
        request,
        fetchFn
      }
    );

    expect(result.isError).toBeFalsy();

    const firstCall = fetchFn.mock.calls[0];
    const requestInit = firstCall?.[1];
    expect(requestInit).toBeDefined();
    if (!requestInit) throw new Error('request init missing');

    const body = JSON.parse(String(requestInit.body));
    expect(body.reply_to).toBeUndefined();
    expect(body.text).not.toContain('Reply-to email:');
  });

  it('returns a graceful error after the third send from the same IP', async () => {
    const cacheKv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 })
    );
    const request = new Request('https://example.com/mcp', {
      headers: {
        'cf-connecting-ip': '198.51.100.42'
      }
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await sendMessageViaResend(
        {
          sender_name: `Sender ${attempt + 1}`,
          message: 'Hello there.'
        },
        {
          cacheKv,
          resendApiKey: 'test-key',
          request,
          fetchFn
        }
      );

      expect(result.isError).toBeFalsy();
    }

    const blockedResult = await sendMessageViaResend(
      {
        sender_name: 'Sender 4',
        message: 'This should be blocked.'
      },
      {
        cacheKv,
        resendApiKey: 'test-key',
        request,
        fetchFn
      }
    );

    expect(blockedResult.isError).toBe(true);
    expect(blockedResult.content[0].text).toContain('Rate limit exceeded');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns a graceful error when Resend responds with a failure', async () => {
    const cacheKv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    );
    const request = new Request('https://example.com/mcp', {
      headers: {
        'cf-connecting-ip': '203.0.113.11'
      }
    });

    const result = await sendMessageViaResend(
      {
        sender_name: 'Jordan Lee',
        message: 'Test failure path.'
      },
      {
        cacheKv,
        resendApiKey: 'test-key',
        request,
        fetchFn
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Resend returned an error');
  });
});