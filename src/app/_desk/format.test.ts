import { describe, expect, it } from "vitest";
import { formatCents, formatDollars, parseDollarsToCents } from "./format";

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
});
