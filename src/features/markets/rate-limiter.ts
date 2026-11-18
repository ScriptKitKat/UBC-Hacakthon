import type { Clock } from "./clock";

export type RateLimiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createRateLimiter(clock: Clock, minIntervalMs: number): RateLimiter {
  let nextSlotMs = 0;
  return async (task) => {
    const now = clock.nowMs();
    const startAt = Math.max(now, nextSlotMs);
    nextSlotMs = startAt + minIntervalMs;
    if (startAt > now) {
      await clock.sleep(startAt - now);
    }
    return task();
  };
}
