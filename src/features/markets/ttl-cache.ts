import type { Clock } from "./clock";

export interface TtlCache<T> {
  readonly get: (key: string) => T | undefined;
  readonly set: (key: string, value: T) => void;
}

export function createTtlCache<T>(clock: Clock, ttlMs: number): TtlCache<T> {
  const entries = new Map<string, { readonly value: T; readonly expiresAtMs: number }>();
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
      entries.set(key, { value, expiresAtMs: clock.nowMs() + ttlMs });
    },
  };
}
