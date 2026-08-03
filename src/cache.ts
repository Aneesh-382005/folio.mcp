export async function withCache<T>(
  kv: KVNamespace | undefined,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (kv) {
    try {
      const cached = await kv.get(key);
      if (cached !== null) {
        try {
          return JSON.parse(cached) as T;
        } catch (err) {
          console.warn('[cache] malformed JSON for key', key, err);
          // malformed cache entry, fall through to live fetch
        }
      }
    } catch (err) {
      console.warn('[cache] GET failed', key, err);
      // KV read failure, fall through to live fetch
    }
  }

  const value = await fetcher();
  const serialized = JSON.stringify(value);

  if (kv && serialized !== undefined) {
    try {
      await kv.put(key, serialized, { expirationTtl: ttlSeconds });
    } catch {
      console.warn('[cache] PUT failed', key);
      // KV write failure, ignore and return the live result
    }
  }

  return value;
}

type EtagEntry<T> = {
  etag: string;
  body: T;
  freshUntil: number;
};

// Entries are kept in KV well past freshUntil so a stale request can still revalidate via If-None-Match.
const REVALIDATION_WINDOW_MULTIPLIER = 8;

// Like withCache, but revalidates stale entries via ETag/If-None-Match instead of always re-fetching.
export async function fetchWithEtagCache(
  kv: KVNamespace | undefined,
  key: string,
  ttlSeconds: number,
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (!kv) return fetchFn(url, init);

  const cached = await kv.get(key).then(
    (raw) => (raw ? (JSON.parse(raw) as EtagEntry<string>) : null),
    (err) => { console.warn('[cache] GET failed', key, err); return null; }
  );

  if (cached && Date.now() < cached.freshUntil) {
    return new Response(cached.body, { status: 200 });
  }

  const headers = new Headers(init.headers);
  if (cached) headers.set('If-None-Match', cached.etag);

  const response = await fetchFn(url, { ...init, headers });

  if (response.status === 304 && cached) {
    await putEtagEntry(kv, key, { ...cached, freshUntil: Date.now() + ttlSeconds * 1000 });
    return new Response(cached.body, { status: 200 });
  }

  if (!response.ok) return response;

  const etag = response.headers.get('ETag');
  const body = await response.text();

  if (etag) {
    await putEtagEntry(kv, key, { etag, body, freshUntil: Date.now() + ttlSeconds * 1000 });
  }

  return new Response(body, { status: 200 });
}

async function putEtagEntry(kv: KVNamespace, key: string, entry: EtagEntry<string>) {
  const remainingFreshSeconds = Math.max(1, Math.round((entry.freshUntil - Date.now()) / 1000));
  try {
    await kv.put(key, JSON.stringify(entry), { expirationTtl: remainingFreshSeconds * REVALIDATION_WINDOW_MULTIPLIER });
  } catch {
    console.warn('[cache] PUT failed', key);
  }
}
