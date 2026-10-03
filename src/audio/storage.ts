import { HttpStorage, type Storage, type StorageResponse } from "smplr";

// Sample fetching. GitHub Pages rate-limits, so on secure origins we keep a Cache API copy.
// Unlike smplr's CacheStorage we never cache non-200 responses (a cached 404 would stick forever).

const CACHE_NAME = "improv-troop-samples-v1";

function cacheAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof caches !== "undefined" &&
    (window.isSecureContext ?? false)
  );
}

let cachePromise: Promise<Cache | null> | null = null;
function openCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise = cacheAvailable()
      ? caches.open(CACHE_NAME).catch(() => null)
      : Promise.resolve(null);
  }
  return cachePromise;
}

const failedResponse = (status: number): StorageResponse => ({
  status,
  arrayBuffer: async () => new ArrayBuffer(0),
  json: async () => null,
  text: async () => "",
});

/** Fetch through the Cache API when we can, plain fetch otherwise. Never throws. */
export const SafeCacheStorage: Storage = {
  async fetch(url: string): Promise<StorageResponse> {
    try {
      const cache = await openCache();
      if (cache) {
        const hit = await cache.match(url).catch(() => undefined);
        if (hit) return hit;
        const res = await fetch(url);
        if (res.status === 200) cache.put(url, res.clone()).catch(() => undefined);
        return res;
      }
      return await HttpStorage.fetch(url);
    } catch {
      return failedResponse(0);
    }
  },
};

/** Wraps a storage and counts outcomes so we can tell "loaded" from "silently loaded nothing". */
export class CountingStorage implements Storage {
  ok = 0;
  failed = 0;
  readonly failedUrls = new Set<string>();

  constructor(private readonly inner: Storage = SafeCacheStorage) {}

  async fetch(url: string): Promise<StorageResponse> {
    try {
      const res = await this.inner.fetch(url);
      if (res.status === 200) this.ok++;
      else {
        this.failed++;
        this.failedUrls.add(url);
      }
      return res;
    } catch {
      this.failed++;
      this.failedUrls.add(url);
      return failedResponse(0);
    }
  }
}
