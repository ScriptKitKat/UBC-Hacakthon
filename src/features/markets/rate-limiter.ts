import type { Clock } from "./clock";

export type RateLimiter = <T>(task: () => Promise<T>, signal: AbortSignal) => Promise<T>;

export class RateLimiterBusyError extends Error {
  constructor() {
    super("rate limiter queue is full");
  }
}

export class RateLimiterTimeoutError extends Error {
  constructor() {
    super("request timed out while queued");
  }
}

export function createRateLimiter(clock: Clock, minIntervalMs: number, maxQueued: number): RateLimiter {
  let nextSlotMs = 0;
  let queued = 0;
  return async (task, signal) => {
    const now = clock.nowMs();
    const startAt = Math.max(now, nextSlotMs);
    if (startAt > now) {
      if (queued >= maxQueued) throw new RateLimiterBusyError();
      nextSlotMs = startAt + minIntervalMs;
      queued += 1;
      try {
        await clock.sleep(startAt - now);
      } finally {
        queued -= 1;
      }
    } else {
      nextSlotMs = startAt + minIntervalMs;
    }
    if (signal.aborted) throw new RateLimiterTimeoutError();
    return task();
  };
}
