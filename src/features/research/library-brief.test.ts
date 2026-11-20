import { describe, expect, it } from "vitest";
import type { ResearchView } from "@/shared";
import { composeLibraryBrief } from "./library-brief";

const SYMBOL = "GEMI-FED261211-MAINTAIN";

const view: ResearchView = {
  symbol: SYMBOL,
  generatedAt: "2026-11-12T18:00:00.000Z",
  timeframe: "1D",
  market: {
    eventTicker: "FED261211",
    eventTitle: "Fed decision in December?",
    contractLabel: "Fed maintains rate",
    category: "Economics",
    subcategory: null,
    expiryDate: "2026-12-11T19:00:00Z",
    eventStatus: "active",
    marketState: "open",
    rulesText: "Resolves YES if the Fed holds the target range at the December meeting.",
    imageUrl: null,
    termsLink: "https://www.gemini.com/legal/prediction-market-terms",
    volume: 12345,
    volume24h: 678,
    quantityLimits: null,
    prices: { buyYesCents: 48, buyNoCents: 54, sellYesCents: 46, sellNoCents: 52, bestBidCents: 46, bestAskCents: 50, lastTradeCents: 48 },
  },
  data: { event: "live", candles: "live", book: "live", trades: "live" },
  series: {
    source: "gemini",
    points: [
      { t: Date.parse("2026-11-01T12:00:00Z"), cents: 40, volume: null, source: "gemini", bidCents: 39, askCents: 41, ma: null, upper: null, lower: null },
      { t: Date.parse("2026-11-08T12:00:00Z"), cents: 48, volume: null, source: "gemini", bidCents: 46, askCents: 50, ma: null, upper: null, lower: null },
    ],
  },
  book: {
    bids: [{ priceCents: 46, amount: 200, cumulative: 200 }, { priceCents: 40, amount: 80, cumulative: 280 }],
    asks: [{ priceCents: 50, amount: 150, cumulative: 150 }, { priceCents: 60, amount: 90, cumulative: 240 }],
  },
  trades: [
    { tradeId: 1, timeMs: 1000, priceCents: 47, amount: 5, side: "buy" },
    { tradeId: 2, timeMs: 2000, priceCents: 48, amount: 2, side: "sell" },
  ],
  indicators: {
    momentum: { value: 55, zone: "neutral", reading: "r" },
    jumpiness: { value: 1, mean: 1, upper: 1, lower: 1, outsideBand: false, reading: "r" },
    volumeSpike: { ratio: 1.2, obvTrend: "up", reading: "r" },
    averagePrice: { value: 44, window: 24, reading: "r" },
    recentMove: { hourCents: 1, dayCents: 8, reading: "r" },
  },
  related: { sameEvent: [], sameCategory: [] },
  postContext: {
    source: "x-feed",
    text: "Powell says the committee could hold in December",
    author: "@Reuters",
    url: "https://x.com/Reuters/status/1",
    why: "Holding rates is the outcome this contract pays on.",
    atMs: Date.parse("2026-11-08T10:00:00Z"),
  },
  matchedPosts: [],
};

const emptyView: ResearchView = {
  ...view,
  market: {
    ...view.market,
    expiryDate: null,
    rulesText: "",
    termsLink: null,
    volume: null,
    volume24h: null,
    prices: { buyYesCents: null, buyNoCents: null, sellYesCents: null, sellNoCents: null, bestBidCents: null, bestAskCents: null, lastTradeCents: null },
  },
  data: { event: "stale", candles: "unavailable", book: "unavailable", trades: "unavailable" },
  series: { source: "none", points: [] },
  book: { bids: [], asks: [] },
  trades: [],
  indicators: {
    momentum: { value: null, zone: null, reading: "r" },
    jumpiness: { value: null, mean: null, upper: null, lower: null, outsideBand: false, reading: "r" },
    volumeSpike: { ratio: null, obvTrend: null, reading: "r" },
    averagePrice: { value: null, window: 0, reading: "r" },
    recentMove: { hourCents: null, dayCents: null, reading: "r" },
  },
  postContext: null,
  matchedPosts: [],
};

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => String(Number(token.replaceAll(",", ""))));
}

describe("composeLibraryBrief", () => {
  it("emits only design sections that have real inputs, including terms and dated posts", () => {
    const brief = composeLibraryBrief(view);
    const titles = brief.sections.map((section) => section.title);
    expect(titles).toEqual([
      "How it resolves",
      "Key numbers when written",
      "What moved the odds",
      "Case for YES",
      "Case for NO",
      "Coming up before it resolves",
      "Crowd and sentiment",
      "History and base rates",
      "What would change the agent's mind",
      "Sources",
    ]);
    expect(brief.evidence?.yesCentsWhenWritten).toBe(48);
    expect(brief.evidence?.bottomLine).toContain("48%");
    expect(brief.evidence?.estimateCents).toBeUndefined();
    expect(brief.evidence?.sources).toEqual([
      { title: "Official market terms", url: "https://www.gemini.com/legal/prediction-market-terms" },
      { title: "@Reuters", url: "https://x.com/Reuters/status/1" },
    ]);
    const moved = brief.sections.find((section) => section.title === "What moved the odds")?.body ?? "";
    expect(moved).toContain("Powell says the committee could hold in December");
    expect(moved).not.toContain("invent");
    expect(brief.sections.find((section) => section.title === "Crowd and sentiment")?.body).not.toContain("Sentiment");
    expect(brief.sections.find((section) => section.title === "Crowd and sentiment")?.body).not.toContain("holders");
  });

  it("does not invent numbers, mentions, or sources when inputs are missing", () => {
    const brief = composeLibraryBrief(emptyView);
    expect(brief.evidence?.sources).toBeUndefined();
    expect(brief.evidence?.keyNumbers).toBeUndefined();
    expect(brief.evidence?.upcoming).toBeUndefined();
    expect(brief.sections.map((section) => section.title)).not.toContain("Sources");
    expect(brief.sections.map((section) => section.title)).not.toContain("Key numbers when written");
    expect(brief.sections.map((section) => section.title)).not.toContain("Upcoming events");
    expect(brief.sections.map((section) => section.title)).not.toContain("Coming up before it resolves");
    const text = [brief.headline, ...brief.sections.map((section) => section.body)].join(" ");
    expect(text).not.toMatch(/\$\d/u);
    expect(numbersIn(text)).toEqual([]);
  });

  it("keeps every number traceable to the research view or a named derivation", () => {
    const brief = composeLibraryBrief(view);
    const text = [brief.headline, ...brief.sections.map((section) => section.body), brief.evidence?.bottomLine ?? ""].join(" ");
    const allowed = new Set(numbersIn([
      view.generatedAt,
      view.market.eventTitle,
      view.market.contractLabel,
      view.market.expiryDate ?? "",
      view.market.rulesText,
      String(view.market.volume),
      String(view.market.volume24h),
      ...Object.values(view.market.prices).map((value) => (value === null ? "" : String(value))),
      ...view.series.points.flatMap((point) => [String(point.cents), String(point.t)]),
      ...view.book.bids.flatMap((level) => [String(level.priceCents), String(level.amount)]),
      ...view.book.asks.flatMap((level) => [String(level.priceCents), String(level.amount)]),
      ...view.trades.flatMap((trade) => [String(trade.priceCents), String(trade.amount), String(trade.timeMs)]),
      String(view.indicators.momentum.value),
      view.postContext?.text ?? "",
      view.postContext?.url ?? "",
    ].join(" ")));
    const derived = new Set(["4", "8", "12", "12.3", "54", "100", "200", "150", "57", "29", "1", "2026"]);
    const invented = numbersIn(text).filter((token) => !allowed.has(token) && !derived.has(token));
    expect(invented).toEqual([]);
  });
});
