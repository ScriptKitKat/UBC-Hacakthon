import { describe, expect, it } from "vitest";
import type { CatalogCard } from "@/shared";
import { changeLabel, marketHref } from "./market-card";

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    eventTicker: "BTC",
    eventTitle: "Bitcoin price today?",
    contractLabel: "Yes",
    instrumentSymbol: "GEMI-BTC261119-YES",
    category: "Crypto",
    categoryLabel: "Crypto",
    expiryDate: "2026-11-21T00:00:00.000Z",
    endsIn: "ends in 2d",
    yesCents: 52,
    noCents: 48,
    changePercent: 22.2,
    sparkline: [40, 45, 52],
    tradeable: true,
    ...overrides,
  };
}

describe("market card preview", () => {
  it("links to the live research page for the instrument", () => {
    expect(marketHref("GEMI-BTC261119-YES")).toBe("/markets/GEMI-BTC261119-YES");
    expect(marketHref("a/b")).toBe("/markets/a%2Fb");
  });

  it("labels a 24h change from live catalog data and hides the label when unknown", () => {
    expect(changeLabel(card())).toBe("+22.2% 24h");
    expect(changeLabel(card({ changePercent: -3 }))).toBe("−3% 24h");
    expect(changeLabel(card({ changePercent: null }))).toBeNull();
  });
});
