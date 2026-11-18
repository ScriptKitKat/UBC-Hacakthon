import { describe, expect, it } from "vitest";
import { budgetTone, formatCents, formatChance, formatDollars, parseDollarsToCents, percentOf, shortenMiddle, yesSharePercent } from "./format";

describe("desk formatting", () => {
  it("renders odds in cents and budgets in dollars", () => {
    expect(formatCents(62)).toBe("62¢");
    expect(formatDollars(1850)).toBe("$18.50");
  });

  it.each([
    ["2", 200],
    ["2.5", 250],
    [" 0.07 ", 7],
  ])("parses %s dollars", (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each(["", "abc", "-1", "1.234", "1e3"])("rejects %j", (text) => {
    expect(parseDollarsToCents(text)).toBeUndefined();
  });

  it.each([
    [6, "6% chance"],
    [62.4, "62% chance"],
    [0, "0% chance"],
    [100, "100% chance"],
    [130, "100% chance"],
  ])("describes %j cents as %s", (cents, caption) => {
    expect(formatChance(cents)).toBe(caption);
  });

  it("clamps shares into 0-100", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(-5, 200)).toBe(0);
  });

  it.each([
    [62, 38, 62],
    [60, 60, 50],
    [70, null, 70],
    [null, 30, 70],
    [null, null, undefined],
  ])("splits yes %j / no %j into a yes share of %j", (yes, no, share) => {
    expect(yesSharePercent(yes, no)).toBe(share);
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
