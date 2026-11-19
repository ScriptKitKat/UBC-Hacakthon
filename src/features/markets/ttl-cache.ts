import type { Clock } from "./clock";

export interface TtlCache<T> {
  readonly get: (key: string) => T | undefined;
  readonly set: (key: string, value: T) => void;
  readonly size: () => number;
}

export function createTtlCache<T>(clock: Clock, ttlMs: number, maxEntries: number): TtlCache<T> {
  const entries = new Map<string, { readonly value: T; readonly expiresAtMs: number }>();

  function evict(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (nowMs >= entry.expiresAtMs) entries.delete(key);
    }
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  }

  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (clock.nowMs() >= entry.expiresAtMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: (key, value) => {
      const nowMs = clock.nowMs();
      entries.delete(key);
      entries.set(key, { value, expiresAtMs: nowMs + ttlMs });
      evict(nowMs);
    },
    size: () => entries.size,
  };
}
