import { describe, expect, it } from "vitest";
import { createBrowseCache } from "./browse-cache";
import type { BrowseListResult } from "./browse";

const okPage: BrowseListResult = {
  ok: true,
  page: { markets: [], total: 0, offset: 0, hasMore: false, tabs: [] },
};

describe("createBrowseCache", () => {
  it("returns a cached page and dedupes in-flight work", async () => {
    const cache = createBrowseCache(20_000);
    let starts = 0;
    const first = cache.takeInFlight({ sort: "trending" }, () => {
      starts += 1;
      return new Promise<BrowseListResult>((resolve) => {
        setTimeout(() => {
          resolve(okPage);
        }, 10);
      });
    });
    const second = cache.takeInFlight({ sort: "trending" }, () => {
      starts += 1;
      return Promise.resolve(okPage);
    });
    await Promise.all([first, second]);
    expect(starts).toBe(1);
    expect(cache.get({ sort: "trending" })).toEqual(okPage);
  });

  it("ignores failed pages", async () => {
    const cache = createBrowseCache(20_000);
    const failed: BrowseListResult = { ok: false, reason: "unavailable" };
    await cache.takeInFlight({ sort: "trending" }, () => Promise.resolve(failed));
    expect(cache.get({ sort: "trending" })).toBeUndefined();
  });
});
