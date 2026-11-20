import { expect, it, vi } from "vitest";
import { isStale, waitForIdleOrTimeout } from "./runtime-revision";
import { withReleasedLease } from "./runtime-access";

it("detects revisions written by another runtime only", () => {
  expect(isStale(12, 0, 12)).toBe(false);
  expect(isStale(12, 0, 13)).toBe(true);
  expect(isStale(12, 3, 15)).toBe(false);
  expect(isStale(12, 3, 16)).toBe(true);
});

it("bounds waiting for active runtime accesses", async () => {
  vi.useFakeTimers();
  const waiting = waitForIdleOrTimeout(new Promise<void>(() => undefined), 15_000);
  await vi.advanceTimersByTimeAsync(15_000);
  await expect(waiting).resolves.toBe(true);
  vi.useRealTimers();
});

it("continues immediately when runtime accesses become idle", async () => {
  await expect(waitForIdleOrTimeout(Promise.resolve(), 15_000)).resolves.toBe(false);
});

it("releases page-style access before the next stale revision check", async () => {
  let active = 1;
  let resolveIdle: (() => void) | undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  await expect(withReleasedLease(() => Promise.resolve("page"), () => {
    active -= 1;
    resolveIdle?.();
  })).resolves.toBe("page");
  expect(isStale(4, 0, 5)).toBe(true);
  expect(active).toBe(0);
  await expect(waitForIdleOrTimeout(idle, 15_000)).resolves.toBe(false);
});
