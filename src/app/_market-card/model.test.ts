import { describe, expect, it } from "vitest";
import type { BrowseCard, CatalogCard, WatchlistCard } from "@/shared";
import { browseCardModel, catalogCardModel, changeLabel, marketHref, monogramFor, watchlistCardModel } from "./model";

const IMAGE = "https://assets.gemini.com/predictions/images/btc.avif";

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    eventTicker: "BTC",
    eventTitle: "Bitcoin price today?",
    contractLabel: "$61,400 or above",
    instrumentSymbol: "GEMI-BTC261119-YES",
    category: "Crypto",
    categoryLabel: "Crypto",
    expiryDate: "2026-11-21T00:00:00.000Z",
    endsIn: "ends in 2d",
    imageUrl: IMAGE,
    yesCents: 63,
    noCents: 38,
    changePercent: 22.2,
    sparkline: [40, 45, 52],
    tradeable: true,
    ...overrides,
  };
}

function watched(overrides: Partial<WatchlistCard> = {}): WatchlistCard {
  return {
    ...card(),
    savedAt: "2026-11-18T00:00:00.000Z",
    savedYesCents: 43,
    todayPoints: 2,
    status: "live",
    href: "/markets/GEMI-BTC261119-YES?contract=GEMI-BTC261119-YES",
    ...overrides,
  };
}

function browse(overrides: Partial<BrowseCard> = {}): BrowseCard {
  return {
    eventTicker: "NBA-POR-NYK",
    eventTitle: "Portland vs New York",
    displayTitle: "Portland vs New York",
    instrumentSymbol: "GEMI-NBA-NYK",
    href: "/markets/GEMI-NBA-NYK?contract=GEMI-NBA-NYK",
    category: "Sports",
    categoryLabel: "Pro Basketball",
    kind: "sports",
    isLive: true,
    when: null,
    spotLabel: null,
    imageUrl: IMAGE,
    volume: 484.43,
    volumeLabel: "$484.43",
    moreCount: 0,
    rows: [
      { instrumentSymbol: "GEMI-NBA-NYK", label: "New York", yesCents: 66, payoutBeginner: "$1 → $1.52", payoutPro: "1.5x", href: "/markets/GEMI-NBA-NYK?contract=GEMI-NBA-NYK" },
      { instrumentSymbol: "GEMI-NBA-POR", label: "Portland", yesCents: 39, payoutBeginner: "$1 → $2.56", payoutPro: "2.6x", href: "/markets/GEMI-NBA-POR?contract=GEMI-NBA-POR" },
    ],
    changePercent: -3.3,
    createdAt: null,
    expiryDate: "2026-11-23T18:30:00.000Z",
    ...overrides,
  };
}

describe("market card model", () => {
  it("links to the live research page for the instrument", () => {
    expect(marketHref("GEMI-BTC261119-YES")).toBe("/markets/GEMI-BTC261119-YES");
    expect(marketHref("a/b")).toBe("/markets/a%2Fb");
  });

  it("labels a 24h change and hides the label when unknown", () => {
    expect(changeLabel(22.2)).toEqual({ label: "+22.2% 24h", trend: "up" });
    expect(changeLabel(-3)).toEqual({ label: "−3% 24h", trend: "down" });
    expect(changeLabel(null)).toBeNull();
  });

  it("shows a catalog contract as Yes and No rows with a $1 payout for each side", () => {
    const model = catalogCardModel(card(), true);
    expect(model.detail).toBe("$61,400 or above");
    expect(model.closes).toMatch(/^Closes Nov \d+/u);
    expect(model.outcomes.map((outcome) => [outcome.label, outcome.percent, outcome.payout])).toEqual([
      ["Yes", 63, "$1 → $1.59"],
      ["No", 38, "$1 → $2.63"],
    ]);
    expect(model.outcomes.every((outcome) => outcome.href === "/markets/GEMI-BTC261119-YES")).toBe(true);
    expect(catalogCardModel(card(), false).outcomes[0]?.payout).toBe("1.6x");
  });

  it("uses the Gemini event image only from a trusted https host and falls back to a monogram", () => {
    expect(catalogCardModel(card(), true).iconUrl).toBe(IMAGE);
    expect(catalogCardModel(card({ imageUrl: "http://assets.gemini.com/x.avif" }), true).iconUrl).toBeNull();
    expect(catalogCardModel(card({ imageUrl: "https://evil.example/x.avif" }), true).iconUrl).toBeNull();
    expect(catalogCardModel(card({ imageUrl: null }), true).monogram).toBe("B");
    expect(monogramFor("¿?")).toBe("M");
  });

  it("marks ended and settled watchlist markets instead of a close time and drops their change", () => {
    expect(watchlistCardModel(watched(), true).closes).toMatch(/^Closes /u);
    const settled = watchlistCardModel(watched({ status: "settled", yesCents: null, noCents: null }), true);
    expect(settled.closes).toBe("Settled");
    expect(settled.change).toBeNull();
    expect(settled.outcomes.map((outcome) => outcome.payout)).toEqual([null, null]);
    expect(watchlistCardModel(watched({ status: "ended" }), true).closes).toBe("Ended");
  });

  it("maps browse rows to outcomes in the selected payout style", () => {
    const model = browseCardModel(browse(), true);
    expect(model.live).toBe(true);
    expect(model.category).toBe("Pro Basketball");
    expect(model.outcomes.map((outcome) => [outcome.label, outcome.percent, outcome.payout])).toEqual([
      ["New York", 66, "$1 → $1.52"],
      ["Portland", 39, "$1 → $2.56"],
    ]);
    expect(browseCardModel(browse(), false).outcomes[1]?.payout).toBe("2.6x");
    expect(browseCardModel(browse({ spotLabel: "$91,200" }), true).detail).toBe("Current: $91,200");
  });
});
