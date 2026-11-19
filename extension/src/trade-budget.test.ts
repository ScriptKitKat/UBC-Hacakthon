import { describe, expect, it } from "vitest";
import { MAX_FEED_BUY_CENTS } from "@/shared";
import { needsApprovalNote, overTradeLimitMessage, tradeBudgetFrom, tradeCapCents } from "./trade-budget";

const budget = { perTradeMaxCents: 1000, remainingCents: 1800, autoApproveMaxCents: 200 };

describe("trade budget cap", () => {
  it("caps at the tightest of the API ceiling, per-trade max and remaining daily budget", () => {
    expect(tradeCapCents(undefined)).toBe(MAX_FEED_BUY_CENTS);
    expect(tradeCapCents(budget)).toBe(1000);
    expect(tradeCapCents({ ...budget, remainingCents: 350 })).toBe(350);
    expect(tradeCapCents({ ...budget, remainingCents: 0 })).toBe(0);
    expect(tradeCapCents({ ...budget, perTradeMaxCents: 200_000, remainingCents: 150_000 })).toBe(MAX_FEED_BUY_CENTS);
  });

  it("ignores incomplete or invalid budget payloads", () => {
    expect(tradeBudgetFrom(undefined)).toBeUndefined();
    expect(tradeBudgetFrom({ dailyCapCents: 2000, spentCents: 0, remainingCents: 2000, researchSpentCents: 0 })).toBeUndefined();
    expect(tradeBudgetFrom({ ...budget, dailyCapCents: 2000, spentCents: 0, researchSpentCents: 0, remainingCents: 1.5 })).toBeUndefined();
    expect(tradeBudgetFrom({ ...budget, dailyCapCents: 2000, spentCents: 0, researchSpentCents: 0, perTradeMaxCents: -1 })).toBeUndefined();
  });

  it("explains the desk limits without advertising the API ceiling as a personal max", () => {
    expect(overTradeLimitMessage(1000, budget)).toBeNull();
    expect(overTradeLimitMessage(1001, budget)).toBe("Over your limit: max 10 USDC per trade (18 USDC left today)");
    expect(overTradeLimitMessage(400, { ...budget, remainingCents: 350 })).toBe("Over your limit: max 10 USDC per trade (3.50 USDC left today)");
    expect(overTradeLimitMessage(MAX_FEED_BUY_CENTS, undefined)).toBeNull();
    expect(overTradeLimitMessage(MAX_FEED_BUY_CENTS + 1, undefined)).toBe("Maximum 1000 USDC per order.");
  });

  it("notes approval only for amounts the desk can still accept", () => {
    expect(needsApprovalNote(200, budget)).toBeNull();
    expect(needsApprovalNote(201, budget)).toBe("Needs approval");
    expect(needsApprovalNote(1000, budget)).toBe("Needs approval");
    expect(needsApprovalNote(1001, budget)).toBeNull();
    expect(needsApprovalNote(500, undefined)).toBeNull();
  });
});
