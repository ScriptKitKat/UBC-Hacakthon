import { describe, expect, it } from "vitest";
import { centsToUsd, usdToCents } from "./amount";

describe("usdToCents", () => {
  it.each([
    [1, 100],
    [2.5, 250],
    [0.29, 29],
    [0.01, 1],
    [19.99, 1999],
    [50, 5000],
  ])("converts %s dollars to %s cents", (dollars, cents) => {
    expect(usdToCents(dollars)).toBe(cents);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, -0.01, 1.005, 2.999, 0.001, Number.MAX_SAFE_INTEGER])(
    "rejects %s",
    (dollars) => {
      expect(usdToCents(dollars)).toBeUndefined();
    },
  );

  it("round-trips whole cents", () => {
    for (let cents = 1; cents <= 5000; cents += 1) {
      expect(usdToCents(centsToUsd(cents))).toBe(cents);
    }
  });
});
