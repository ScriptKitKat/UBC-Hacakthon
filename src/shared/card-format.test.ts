import { describe, expect, it } from "vitest";
import { changeTrend, contrastInk, formatBudgetCents, formatChangePercent, formatPayoutFromAsk, formatPercent, formatResetLabel, formatSignedPercent, formatVolumeUsd, isXUrl, nextUtcMidnight } from "./card-format";

describe("card format", () => {
  it("formats a yes chance and a signed 24h change", () => {
    expect(formatPercent(52.4)).toBe("52%");
    expect(formatPercent(null)).toBe("—");
    expect(formatSignedPercent(22.2)).toBe("+22.2%");
    expect(formatSignedPercent(-3)).toBe("−3%");
    expect(formatSignedPercent(0)).toBe("0%");
    expect(formatChangePercent(40, 50)).toBe("+25%");
    expect(changeTrend(25)).toBe("up");
    expect(changeTrend(-1)).toBe("down");
    expect(changeTrend(0)).toBe("flat");
    expect(formatBudgetCents(300)).toBe("$3");
    expect(formatBudgetCents(750)).toBe("$7.50");
    expect(isXUrl("https://x.com/user/status/123")).toBe(true);
    expect(isXUrl("Bitcoin above 60k")).toBe(false);
  });

  it("formats volume, $1 payout from the buy ask, and reset time in Chicago", () => {
    expect(formatVolumeUsd(5600)).toBe("$5.6k");
    expect(formatVolumeUsd(1_200_000)).toBe("$1.2M");
    expect(formatVolumeUsd(310_000)).toBe("$310k");
    expect(formatVolumeUsd(83)).toBe("$83");
    expect(formatPayoutFromAsk(48, true)).toBe("$1 → $2.08");
    expect(formatPayoutFromAsk(48, false)).toBe("2.1x");
    expect(formatPayoutFromAsk(null, true)).toBeNull();
    const resetAt = nextUtcMidnight(new Date("2026-11-19T17:30:00.000Z")).toISOString();
    expect(resetAt).toBe("2026-11-20T00:00:00.000Z");
    expect(formatResetLabel(resetAt, "America/Chicago")).toBe("resets 6:00 PM CST");
    expect(contrastInk("#500000")).toBe("#EDEDED");
    expect(contrastInk("#F7931A")).toBe("#0A0A0A");
  });
});
