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