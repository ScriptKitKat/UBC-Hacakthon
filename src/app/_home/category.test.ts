import { describe, expect, it } from "vitest";
import { cachedView, categoryKey, FILTERS, PREFETCH_CATEGORIES } from "./category";

describe("categoryKey", () => {
  it("uses the filter when it is not All", () => {
    expect(categoryKey("Crypto", "Sports")).toBe("Crypto");
    expect(categoryKey("Politics", undefined)).toBe("Politics");
  });

  it("uses the chip when the All filter is on", () => {
    expect(categoryKey("All", "Sports")).toBe("Sports");
    expect(categoryKey("All", undefined)).toBe("All");
  });
});

describe("cachedView", () => {
  it("returns the cached page so filter chips can switch without a fetch", () => {
    const all = { id: "all" };
    const crypto = { id: "crypto" };
    const cache = { All: all, Crypto: crypto };
    expect(cachedView(cache, categoryKey("All", undefined))).toBe(all);
    expect(cachedView(cache, categoryKey("Crypto", undefined))).toBe(crypto);
    expect(cachedView(cache, categoryKey("Sports", undefined))).toBeUndefined();
  });

  it("covers the Moving now chips that should be prefetched", () => {
    expect(FILTERS).toEqual(["All", "Crypto", "Sports", "Politics"]);
    expect(PREFETCH_CATEGORIES).toEqual(["Crypto", "Sports", "Politics", "Economy"]);
  });
});
