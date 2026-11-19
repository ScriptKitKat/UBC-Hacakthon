import { describe, expect, it } from "vitest";
import { clampPercent, formatCents, formatChangePercent, formatDollars, formatHistoryWindow, formatPercent, formatUsdc } from "./format";

describe("format", () => {
  it("formats cents, percents and dollars", () => {
    expect(formatCents(62)).toBe("62¢");
    expect(formatCents(null)).toBe("—");
    expect(formatPercent(61.6)).toBe("62%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDollars(100)).toBe("$1");
    expect(formatDollars(250)).toBe("$2.50");
    expect(formatDollars(5)).toBe("$0.05");
    expect(formatUsdc(2300)).toBe("23 USDC");
    expect(formatUsdc(5348)).toBe("53.48 USDC");
    expect(formatUsdc(5)).toBe("0.05 USDC");
  });

  it("formats the change against the first observed price", () => {
    expect(formatChangePercent(60, 65)).toBe("+8.3%");
    expect(formatChangePercent(65, 60)).toBe("−7.7%");
    expect(formatChangePercent(62, 62)).toBe("0%");
    expect(formatChangePercent(0, 5)).toBeNull();
  });

  it("labels a history window from the first and last timestamps", () => {
    expect(formatHistoryWindow("2026-11-18T22:00:00.000Z", "2026-11-19T22:00:00.000Z")).toBe("24h");
    expect(formatHistoryWindow("2026-11-17T12:00:00.000Z", "2026-11-17T12:00:40.000Z")).toBe("40s");
    expect(formatHistoryWindow("2026-11-19T10:00:00.000Z", "2026-11-19T10:15:00.000Z")).toBe("15m");
    expect(formatHistoryWindow("2026-11-10T00:00:00.000Z", "2026-11-17T00:00:00.000Z")).toBe("7d");
    expect(formatHistoryWindow("2026-11-19T12:00:00.000Z", "2026-11-19T11:00:00.000Z")).toBeNull();
  });

  it("clamps probabilities and defaults unknown ones to even", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(null)).toBe(50);
  });
});
