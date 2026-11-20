import { describe, expect, it } from "vitest";
import { createListCache } from "./list-cache";
import type { CatalogListResult } from "./list";

const okPage: CatalogListResult = {
  ok: true,
  page: { markets: [], total: 0, categories: [], stale: false },
};

describe("createListCache", () => {
  it("returns a cached page and dedupes in-flight work", async () => {
    const cache = createListCache(20_000);
    let starts = 0;
    const first = cache.takeInFlight({ sort: "moving" }, () => {
      starts += 1;
      return new Promise<CatalogListResult>((resolve) => {
        setTimeout(() => {
          resolve(okPage);
        }, 10);
      });
    });
    const second = cache.takeInFlight({ sort: "moving" }, () => {
      starts += 1;
      return Promise.resolve(okPage);
    });
    await Promise.all([first, second]);
    expect(starts).toBe(1);
    expect(cache.get({ sort: "moving" })).toEqual(okPage);
  });

  it("keeps a stale page after a later failure", async () => {
    const cache = createListCache(1);
    await cache.takeInFlight({ sort: "moving" }, () => Promise.resolve(okPage));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cache.get({ sort: "moving" })).toBeUndefined();
    expect(cache.getStale({ sort: "moving" })).toEqual(okPage);
  });
});
