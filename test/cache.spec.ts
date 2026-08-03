import { describe, expect, it, vi } from 'vitest';
import { fetchWithEtagCache } from '../src/cache';

type StoredValue = { value: string; expiration?: number };

class MockKv {
  private store = new Map<string, StoredValue>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration <= Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, {
      value,
      expiration: options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined
    });
  }
}

describe('fetchWithEtagCache', () => {
  it('fetches live and stores the ETag on a cache miss', async () => {
    const kv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200, headers: { ETag: 'v1' } }));

    const response = await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(await response.text()).toBe('hello');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves from cache with zero network calls while still fresh', async () => {
    const kv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200, headers: { ETag: 'v1' } }));

    await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);
    const second = await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(await second.text()).toBe('hello');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('revalidates with If-None-Match once stale and reuses the cached body on 304', async () => {
    const kv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200, headers: { ETag: 'v1' } }));

    await fetchWithEtagCache(kv, 'k', 0, 'https://example.com', {}, fetchFn);

    fetchFn.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    const revalidated = await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(await revalidated.text()).toBe('hello');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const revalidateInit = fetchFn.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(revalidateInit.headers).get('If-None-Match')).toBe('v1');
  });

  it('replaces the cached body when a stale entry changed upstream (200)', async () => {
    const kv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200, headers: { ETag: 'v1' } }));

    await fetchWithEtagCache(kv, 'k', 0, 'https://example.com', {}, fetchFn);

    fetchFn.mockImplementationOnce(async () => new Response('updated', { status: 200, headers: { ETag: 'v2' } }));
    const updated = await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(await updated.text()).toBe('updated');
  });

  it('bypasses caching entirely when no KV namespace is provided', async () => {
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200, headers: { ETag: 'v1' } }));

    await fetchWithEtagCache(undefined, 'k', 60, 'https://example.com', {}, fetchFn);
    await fetchWithEtagCache(undefined, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not cache a response with no ETag header', async () => {
    const kv = new MockKv() as unknown as KVNamespace;
    const fetchFn = vi.fn(async () => new Response('hello', { status: 200 }));

    await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);
    await fetchWithEtagCache(kv, 'k', 60, 'https://example.com', {}, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
