// Small per-process TTL cache for PaiFlow reads. PaiFlow event ingestion runs
// 10–20 s behind (llms.md), so caching reads for at least 10 s both respects
// that budget and keeps UI polling (every 3-5 s) from hammering the upstream
// API. Errors are never cached.
type Entry = { value: unknown; expiresAt: number };
const cache = new Map<string, Entry>();

export async function getCached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.value as T;
  const value = await producer();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function clearReadCache(): void {
  cache.clear();
}
