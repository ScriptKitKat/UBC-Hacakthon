import { describe, expect, it } from "vitest";
import { changeTrend, formatBudgetCents, formatChangePercent, formatPercent, formatSignedPercent, isXUrl } from "./card-format";

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
});
