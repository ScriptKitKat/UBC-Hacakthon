import { describe, expect, it, vi } from "vitest";
import { BRIEF_SECTION_TITLES } from "@/shared";
import type { ResearchView } from "@/shared";
import { composeBrief, polishBrief } from "./brief";
import type { JsonCompleter } from "./brief";

const SYMBOL = "GEMI-FED261211-MAINTAIN";

const view: ResearchView = {
  symbol: SYMBOL,
  generatedAt: "2026-11-18T00:00:00.000Z",
  timeframe: "1D",
  market: {
    eventTicker: "FED261211", eventTitle: "Fed decision in December?", contractLabel: "Fed maintains rate", category: "Economics", subcategory: null,
    expiryDate: "2026-12-11T19:00:00Z", eventStatus: "active", marketState: "open", rulesText: "Resolves YES if the Fed holds the target range at the December meeting.",
    imageUrl: null, termsLink: null,
    volume: 12345, volume24h: 678, quantityLimits: null,
    prices: { buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38, bestBidCents: 60, bestAskCents: 62, lastTradeCents: 61 },
  },
  data: { event: "live", candles: "live", book: "live", trades: "live" },
  series: { source: "mixed", points: [] },
  book: {
    bids: [{ priceCents: 60, amount: 300, cumulative: 300 }, { priceCents: 59, amount: 100, cumulative: 400 }],
    asks: [{ priceCents: 62, amount: 100, cumulative: 100 }],
  },
  trades: [
    { tradeId: 1, timeMs: 1000, priceCents: 61, amount: 5, side: "buy" },
    { tradeId: 2, timeMs: 2000, priceCents: 62, amount: 2, side: "sell" },
    { tradeId: 3, timeMs: 3000, priceCents: 62, amount: 1, side: "buy" },
  ],
  indicators: {
    momentum: { value: 71.4, zone: "overbought", reading: "r" },
    jumpiness: { value: 1, mean: 1, upper: 1, lower: 1, outsideBand: false, reading: "r" },
    volumeSpike: { ratio: 2.5, obvTrend: "up", reading: "r" },
    averagePrice: { value: 60, window: 24, reading: "r" },
    recentMove: { hourCents: 3, dayCents: -2, reading: "r" },
  },
  related: {
    sameEvent: [{ symbol: "GEMI-FED261211-CUT25", eventTitle: "Fed decision in December?", contractLabel: "Cut 25bps", yesCents: 33, noCents: 69 }],
    sameCategory: [{ symbol: "GEMI-CPI-HOT", eventTitle: "CPI above forecast?", contractLabel: "Yes", yesCents: 48, noCents: 54 }],
  },
  postContext: { source: "x-feed", text: "Powell says rates could hold", author: "@Reuters", url: null, why: "Holding rates is the outcome this contract pays on.", atMs: null },
  matchedPosts: [],
};

const emptyView: ResearchView = {
  ...view,
  market: { ...view.market, expiryDate: null, rulesText: "", volume: null, volume24h: null, prices: { buyYesCents: null, buyNoCents: null, sellYesCents: null, sellNoCents: null, bestBidCents: null, bestAskCents: null, lastTradeCents: null } },
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
  related: { sameEvent: [], sameCategory: [] },
  postContext: null,
  matchedPosts: [],
};

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => String(Number(token.replaceAll(",", ""))));
}

function briefNumbers(brief: ReturnType<typeof composeBrief>): string[] {
  return numbersIn([brief.headline, ...brief.sections.map((section) => section.body)].join(" "));
}

function dataNumbers(source: ResearchView): Set<string> {
  return new Set(numbersIn(JSON.stringify({ ...source, symbol: "", generatedAt: "" })));
}

describe("composeBrief", () => {
  it("has the headline and the six titled sections in order", () => {
    const brief = composeBrief(view);
    expect(brief.headline).toBe("Fed decision in December: Fed maintains rate is priced at 62¢ for YES");
    expect(brief.sections.map((section) => section.title)).toEqual([...BRIEF_SECTION_TITLES]);
    expect(brief.polishedBy).toBe("template");
    expect(brief.sections.every((section) => section.body.length > 0)).toBe(true);
  });

  it("states the odds, recent moves, liquidity, related markets and post straight from the data", () => {
    const bodies = Object.fromEntries(composeBrief(view).sections.map((section) => [section.title, section.body]));
    expect(bodies["What the market thinks"]).toContain("Buying YES costs 62¢");
    expect(bodies["What the market thinks"]).toContain("last trade was at 61¢");
    expect(bodies["What changed recently"]).toContain("Last hour: +3¢; last day: -2¢");
    expect(bodies["What changed recently"]).toContain("Momentum reads 71 out of 100: odds have mostly risen recently");
    expect(bodies["Crowd and liquidity"]).toContain("12,345 contracts");
    expect(bodies["Crowd and liquidity"]).toContain("400 contracts bid against 100 contracts offered");
    expect(bodies["Crowd and liquidity"]).toContain("Of the last 3 trades, 2 were buys and 1 were sells");
    expect(bodies["Related markets"]).toContain("Cut 25bps (YES 33¢)");
    expect(bodies["Related markets"]).toContain("CPI above forecast? — Yes (YES 48¢)");
    expect(bodies["What would move it"]).toContain("Powell says rates could hold");
    expect(bodies["What would move it"]).toContain("It expires on 2026-12-11");
  });

  it("uses only numbers that exist in the provided data", () => {
    const allowed = dataNumbers(view);
    const derived = new Set(["71", "80", "5", "24"]);
    const invented = briefNumbers(composeBrief(view)).filter((token) => !allowed.has(token) && !derived.has(token));
    expect(invented).toEqual([]);
  });

  it("says plainly what is missing instead of making numbers up", () => {
    const brief = composeBrief(emptyView);
    const text = brief.sections.map((section) => section.body).join(" ");
    expect(brief.headline).toContain("has no live price right now");
    expect(brief.headline).not.toMatch(/[?!.]:/u);
    expect(text).toContain("no live YES price");
    expect(text).toContain("not enough history to measure");
    expect(text).toContain("Momentum can't be measured yet.");
    expect(text).toContain("The order book is unavailable");
    expect(text).toContain("Recent trades are unavailable.");
    expect(text).toContain("No related markets were found.");
    expect(text).toContain("No post or news item is attached");
    expect(text).toContain("No expiry date is listed.");
    expect(text).toContain("No resolution rules were provided.");
    expect(text).toContain("Gemini wasn't responding");
    expect(text).toContain("There is no price history for this market yet.");
    expect(briefNumbers(brief)).toEqual(["24"]);
  });
});

describe("polishBrief", () => {
  const template = composeBrief(view);
  const bodies = template.sections.map((section) => section.body);
  const answer = (headline: string, sections: readonly string[]): JsonCompleter => vi.fn(() => Promise.resolve({ headline, sections }));

  it("returns the template untouched when no completer is configured", async () => {
    expect(await polishBrief(template, undefined)).toBe(template);
  });

  it("accepts a polish that reuses only the template's numbers", async () => {
    const polished = await polishBrief(template, { by: "grok", complete: answer("Fed holds look priced at 62¢", bodies.map((body) => `${body} (polished)`)) });
    expect(polished.polishedBy).toBe("grok");
    expect(polished.headline).toBe("Fed holds look priced at 62¢");
    expect(polished.sections.map((section) => section.title)).toEqual([...BRIEF_SECTION_TITLES]);
    expect(polished.sections[0]?.body).toBe(`${bodies[0] ?? ""} (polished)`);
  });

  it("sends the template text as structured JSON", async () => {
    const complete = answer(template.headline, bodies);
    await polishBrief(template, { by: "grok", complete: complete });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "brief_polish", user: JSON.stringify({ headline: template.headline, sections: bodies }) }));
  });

  it.each([
    ["an invented digit", (list: string[]) => list.map((body, index) => (index === 0 ? `${body} It could reach 85¢.` : body))],
    ["an invented spelled-out number", (list: string[]) => list.map((body, index) => (index === 1 ? `${body} Traders are seventy percent sure.` : body))],
  ])("falls back to the template when the polish contains %s", async (_name, change) => {
    const polished = await polishBrief(template, { by: "grok", complete: answer(template.headline, change([...bodies])) });
    expect(polished).toBe(template);
  });

  it("falls back when the polish has the wrong number of sections or the wrong shape", async () => {
    expect(await polishBrief(template, { by: "grok", complete: answer(template.headline, bodies.slice(1)) })).toBe(template);
    expect(await polishBrief(template, { by: "grok", complete: vi.fn(() => Promise.resolve({ nonsense: true })) })).toBe(template);
    expect(await polishBrief(template, { by: "grok", complete: vi.fn(() => Promise.resolve(undefined)) })).toBe(template);
  });

  it("falls back when the model call throws", async () => {
    expect(await polishBrief(template, { by: "grok", complete: vi.fn(() => Promise.reject(new Error("down"))) })).toBe(template);
  });
});
