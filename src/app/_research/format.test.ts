import { describe, expect, it } from "vitest";
import { formatCountdown, formatDollarsFromCents, formatPercent, formatPriceCents, formatSignedCents, formatVolume } from "./format";

const NOW = Date.parse("2026-11-18T00:00:00Z");

describe("formatCountdown", () => {
  it("shows days and hours", () => {
    expect(formatCountdown("2026-12-11T05:00:00.000Z", NOW)).toBe("23d 5h left");
  });

  it("shows hours and minutes within a day", () => {
    expect(formatCountdown("2026-11-18T05:30:00.000Z", NOW)).toBe("5h 30m left");
  });

  it("shows at least one minute", () => {
    expect(formatCountdown("2026-11-18T00:00:20.000Z", NOW)).toBe("1m left");
  });

  it("says ended after expiry", () => {
    expect(formatCountdown("2026-11-17T00:00:00.000Z", NOW)).toBe("Ended");
  });

  it("handles missing or invalid expiry", () => {
    expect(formatCountdown(null, NOW)).toBe("No expiry listed");
    expect(formatCountdown("soon", NOW)).toBe("No expiry listed");
  });
});

describe("number formatting", () => {
  it("abbreviates volume", () => {
    expect(formatVolume(null)).toBe("n/a");
    expect(formatVolume(834.93)).toBe("834.93");
    expect(formatVolume(1500)).toBe("1.5k");
    expect(formatVolume(14138.45)).toBe("14k");
    expect(formatVolume(2_500_000)).toBe("2.5M");
  });

  it.each([
    [999.994, "999.99"],
    [999.995, "1.0k"],
    [1_000, "1.0k"],
    [9_949.99, "9.9k"],
    [9_950, "10k"],
    [9_960, "10k"],
    [10_000, "10k"],
    [999_499.99, "999k"],
    [999_500, "1.0M"],
    [999_600, "1.0M"],
    [1_000_000, "1.0M"],
  ])("formats volume %s as %s at a display boundary", (volume, label) => {
    expect(formatVolume(volume)).toBe(label);
  });

  it("formats cents with one decimal at most", () => {
    expect(formatPriceCents(62)).toBe("62¢");
    expect(formatPriceCents(62.34)).toBe("62.3¢");
    expect(formatPriceCents(null)).toBe("n/a");
  });

  it("signs moves", () => {
    expect(formatSignedCents(3)).toBe("+3¢");
    expect(formatSignedCents(-2.5)).toBe("−2.5¢");
    expect(formatSignedCents(null)).toBe("n/a");
  });

  it("formats dollars and percents", () => {
    expect(formatDollarsFromCents(161)).toBe("$1.61");
    expect(formatDollarsFromCents(-20)).toBe("−$0.20");
    expect(formatPercent(16.666)).toBe("16.7%");
    expect(formatPercent(-5, 0)).toBe("−5%");
    expect(formatPercent(null)).toBe("n/a");
  });
});
