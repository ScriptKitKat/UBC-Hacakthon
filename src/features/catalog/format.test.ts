import { describe, expect, it } from "vitest";
import { categoryLabel, categoryQuery, changePercent, downsample, formatBudgetCents, formatChange, formatEndsIn, isXUrl } from "./format";

describe("catalog format", () => {
  it("maps Economics to the Economy chip and back", () => {
    expect(categoryLabel("Economics")).toBe("Economy");
    expect(categoryLabel("Crypto")).toBe("Crypto");
    expect(categoryQuery("Economy")).toBe("Economics");
    expect(categoryQuery("Sports")).toBe("Sports");
    expect(categoryQuery("All")).toBeUndefined();
  });

  it("labels expiry relative to now", () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    expect(formatEndsIn("2026-11-19T22:00:00.000Z", now)).toBe("ends in 4h");
    expect(formatEndsIn("2026-11-26T18:00:00.000Z", now)).toBe("ends in 7d");
    expect(formatEndsIn("2026-11-18T18:00:00.000Z", now)).toBe("ended");
    expect(formatEndsIn(null, now)).toBeNull();
  });

  it("computes a one-decimal change and budget labels", () => {
    expect(changePercent(40, 50)).toBe(25);
    expect(changePercent(56, 44)).toBe(-21.4);
    expect(changePercent(0, 10)).toBeNull();
    expect(formatChange(22.2)).toBe("▲ 22.2%");
    expect(formatChange(-21.4)).toBe("▼ 21.4%");
    expect(formatChange(0)).toBe("0%");
    expect(formatBudgetCents(300)).toBe("$3");
    expect(formatBudgetCents(750)).toBe("$7.50");
  });

  it("detects https X and Twitter links", () => {
    expect(isXUrl("https://x.com/user/status/123")).toBe(true);
    expect(isXUrl("https://www.twitter.com/user/status/123")).toBe(true);
    expect(isXUrl("https://example.com/x")).toBe(false);
    expect(isXUrl("Bitcoin above 60k")).toBe(false);
  });

  it("downsamples a series onto a fixed number of points", () => {
    expect(downsample([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
    expect(downsample([9, 8], 8)).toEqual([9, 8]);
  });
});
