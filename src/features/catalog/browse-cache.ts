import type { BrowseListResult, BrowseQuery } from "./browse";
import { PAGE_SIZE } from "./browse";

const DEFAULT_TTL_MS = 20_000;

export function browseCacheKey(query: BrowseQuery = {}): string {
  return JSON.stringify({
    search: query.search ?? "",
    category: query.category ?? "",
    sort: query.sort ?? "trending",
    offset: query.offset ?? 0,
    limit: query.limit ?? PAGE_SIZE,
  });
}

export function createBrowseCache(ttlMs = DEFAULT_TTL_MS): {
  readonly get: (query: BrowseQuery) => BrowseListResult | undefined;
  readonly getStale: (query: BrowseQuery) => BrowseListResult | undefined;
  readonly set: (query: BrowseQuery, value: BrowseListResult) => void;
  readonly takeInFlight: (query: BrowseQuery, start: () => Promise<BrowseListResult>) => Promise<BrowseListResult>;
  readonly clear: () => void;
} {
  const entries = new Map<string, { readonly value: BrowseListResult; readonly expiresAtMs: number }>();
  const inFlight = new Map<string, Promise<BrowseListResult>>();

  return {
    get: (query) => {
      const key = browseCacheKey(query);
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (Date.now() >= entry.expiresAtMs) return undefined;
      return entry.value;
    },
    getStale: (query) => entries.get(browseCacheKey(query))?.value,
    set: (query, value) => {
      if (!value.ok) return;
      entries.set(browseCacheKey(query), { value, expiresAtMs: Date.now() + ttlMs });
    },
    takeInFlight: (query, start) => {
      const key = browseCacheKey(query);
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
