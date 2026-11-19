import type { CatalogListResult, CatalogQuery } from "./list";

const DEFAULT_TTL_MS = 20_000;

export function listCacheKey(query: CatalogQuery = {}): string {
  return JSON.stringify({
    search: query.search ?? "",
    category: query.category ?? "",
    sort: query.sort ?? "moving",
    offset: query.offset ?? 0,
    limit: query.limit ?? 6,
    includeSparklines: query.includeSparklines === true,
  });
}

export function createListCache(ttlMs = DEFAULT_TTL_MS): {
  readonly get: (query: CatalogQuery) => CatalogListResult | undefined;
  readonly getStale: (query: CatalogQuery) => CatalogListResult | undefined;
  readonly takeInFlight: (query: CatalogQuery, start: () => Promise<CatalogListResult>) => Promise<CatalogListResult>;
  readonly clear: () => void;
} {
  const entries = new Map<string, { readonly value: CatalogListResult; readonly expiresAtMs: number }>();
  const inFlight = new Map<string, Promise<CatalogListResult>>();

  return {
    get: (query) => {
      const key = listCacheKey(query);
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (Date.now() >= entry.expiresAtMs) return undefined;
      return entry.value;
    },
    getStale: (query) => entries.get(listCacheKey(query))?.value,
    takeInFlight: (query, start) => {
      const key = listCacheKey(query);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const work = start().then((value) => {
        if (value.ok) entries.set(key, { value, expiresAtMs: Date.now() + ttlMs });
        inFlight.delete(key);
        return value;
      }, (error: unknown) => {
        inFlight.delete(key);
        throw error;
      });
      inFlight.set(key, work);
      return work;
    },
    clear: () => {
      entries.clear();
      inFlight.clear();
    },
  };
}
