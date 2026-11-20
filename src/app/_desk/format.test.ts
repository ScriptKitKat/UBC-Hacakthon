import { describe, expect, it } from "vitest";
import { budgetTone, formatDollars, percentOf, shortenMiddle } from "./format";

describe("desk formatting", () => {
  it("renders budgets in dollars", () => {
    expect(formatDollars(1850)).toBe("$18.50");
  });

  it("clamps shares into 0-100", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(-5, 200)).toBe(0);
  });

  it.each([
    [1000, 2000, "healthy"],
    [500, 2000, "low"],
    [200, 2000, "critical"],
    [0, 0, "critical"],
  ] as const)("rates %j remaining of %j as %s", (remaining, cap, tone) => {
    expect(budgetTone(remaining, cap)).toBe(tone);
  });

  it("shortens only long text", () => {
    expect(shortenMiddle("abcdefghijklmnop", 4, 3)).toBe("abcd…nop");
    expect(shortenMiddle("abcdefgh", 4, 3)).toBe("abcdefgh");
  });
});
