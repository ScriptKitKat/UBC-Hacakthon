import type { Clock } from "./clock";

export interface TtlCache<T> {
  readonly get: (key: string) => T | undefined;
  readonly getStale: (key: string) => T | undefined;
  readonly set: (key: string, value: T, ttlMs?: number) => void;
  readonly size: () => number;
}

export function createTtlCache<T>(clock: Clock, ttlMs: number, maxEntries: number): TtlCache<T> {
  const entries = new Map<string, { readonly value: T; readonly expiresAtMs: number }>();

  function evict(): void {
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  }

  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (clock.nowMs() >= entry.expiresAtMs) return undefined;
      return entry.value;
    },
    getStale: (key) => entries.get(key)?.value,
    set: (key, value, entryTtlMs = ttlMs) => {
      const nowMs = clock.nowMs();
      entries.delete(key);
      entries.set(key, { value, expiresAtMs: nowMs + entryTtlMs });
      evict();
    },
    size: () => entries.size,
  };
}
