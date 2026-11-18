import { describe, expect, it } from "vitest";
import { clampPercent, formatCents, formatChangePercent, formatDollars, formatPercent } from "./format";

describe("format", () => {
  it("formats cents, percents and dollars", () => {
    expect(formatCents(62)).toBe("62¢");
    expect(formatCents(null)).toBe("—");
    expect(formatPercent(61.6)).toBe("62%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDollars(100)).toBe("$1");
    expect(formatDollars(250)).toBe("$2.50");
    expect(formatDollars(5)).toBe("$0.05");
  });

  it("formats the change against the first observed price", () => {
    expect(formatChangePercent(60, 65)).toBe("+8.3%");
    expect(formatChangePercent(65, 60)).toBe("−7.7%");
    expect(formatChangePercent(62, 62)).toBe("0%");
    expect(formatChangePercent(0, 5)).toBeNull();
  });

  it("clamps probabilities and defaults unknown ones to even", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(null)).toBe(50);
  });
});
