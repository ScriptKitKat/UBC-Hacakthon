import { describe, expect, it } from "vitest";
import type { Clock } from "./clock";
import { RateLimiterBusyError, RateLimiterTimeoutError, createRateLimiter } from "./rate-limiter";
import { createTtlCache } from "./ttl-cache";

function manualClock(): Clock & { readonly release: () => void; readonly advance: (ms: number) => void } {
  let now = 0;
  const waiting: (() => void)[] = [];
  return {
    nowMs: () => now,
    sleep: () => new Promise((resolve) => waiting.push(resolve)),
    release: () => {
      for (const resolve of waiting.splice(0)) resolve();
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("rejects with a busy error once the queue is full", async () => {
    const clock = manualClock();
    const limit = createRateLimiter(clock, 1000, 2);
    const signal = new AbortController().signal;
    const first = limit(() => Promise.resolve("a"), signal);
    const queued = [limit(() => Promise.resolve("b"), signal), limit(() => Promise.resolve("c"), signal)];
    await expect(limit(() => Promise.resolve("d"), signal)).rejects.toBeInstanceOf(RateLimiterBusyError);
    clock.release();
    await expect(first).resolves.toBe("a");
    await expect(Promise.all(queued)).resolves.toEqual(["b", "c"]);
  });

  it("does not run a task whose timeout expired while it was queued", async () => {
    const clock = manualClock();
    const limit = createRateLimiter(clock, 1000, 5);
    const controller = new AbortController();
    await limit(() => Promise.resolve(), controller.signal);
    let ran = false;
    const waiting = limit(() => {
      ran = true;
      return Promise.resolve();
    }, controller.signal);
    controller.abort();
    clock.release();
    await expect(waiting).rejects.toBeInstanceOf(RateLimiterTimeoutError);
    expect(ran).toBe(false);
  });
});

describe("createTtlCache", () => {
  it("drops expired entries on write and caps the number of entries", () => {
    const clock = manualClock();
    const cache = createTtlCache<number>(clock, 100, 3);
    cache.set("a", 1);
    clock.advance(200);
    cache.set("b", 2);
    expect(cache.size()).toBe(1);
    cache.set("c", 3);
    cache.set("d", 4);
    cache.set("e", 5);
    expect(cache.size()).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("e")).toBe(5);
  });
});
