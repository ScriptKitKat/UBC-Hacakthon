import { describe, expect, it, vi } from "vitest";
import { openHistoryStore } from "@/features/history";
import { fail, ok } from "@/features/markets";
import type { Candle, MarketContract, MarketEvent, MarketsResult, OrderBook, RecentTrade } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import { instrumentSymbol, researchViewSchema } from "@/shared";
import type { ResearchPostContext } from "@/shared";
import { createResearch } from "./view";
import type { ResearchMarkets } from "./view";

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const OTHER = "GEMI-FED261211-CUT25";
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function contract(symbol: string, label: string, yes: number | null, no: number | null, marketState = "open"): MarketContract {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label,
    description: `Rules for ${label}`,
    expiryDate: "2026-12-11T05:00:00.000Z",
    marketState,
    status: "active",
    prices: { bestBidCents: 60, bestAskCents: 62, lastTradeCents: 61, buyYesCents: yes, buyNoCents: no, sellYesCents: 60, sellNoCents: 38 },
    limits: null,
  };
}

function event(ticker: string, category: string, contracts: MarketContract[]): MarketEvent {
  return {
    ticker,
    title: `Title ${ticker}`,
    category,
    status: "active",
    expiryDate: null,
    description: "Event description",
    subcategory: null,
    volume: 1000,
    volume24h: 50,
    tags: [],
    contracts,
  };
}

const fedEvent = () => event("FED261211", "Economics", [contract(SYMBOL, "Fed maintains rate", 62, 40), contract(OTHER, "Cut 25bps", 30, 72)]);
const otherEvents = () => [fedEvent(), event("CPI261212", "Economics", [contract("GEMI-CPI261212-HIGH", "High", 20, 82), contract("GEMI-CPI261212-LOW", "Low", 70, 32)]), event("EMPTY", "Economics", [])];

const candle = (timeMs: number, closeCents: number, volume = 5): Candle => ({ timeMs, openCents: closeCents, highCents: closeCents, lowCents: closeCents, closeCents, volume });
const hourlyCandles = Array.from({ length: 30 }, (_, index) => candle(NOW - index * HOUR, 60 + (index % 3)));
const book: OrderBook = { bids: [{ priceCents: 60, amount: 10 }, { priceCents: 59, amount: 5 }], asks: [{ priceCents: 62, amount: 8 }] };
const trades: RecentTrade[] = [{ tradeId: 1, timeMs: NOW - 1000, priceCents: 62, amount: 3, side: "buy" }];

interface Overrides {
  readonly getEvent?: ResearchMarkets["getEvent"];
  readonly candles?: ResearchMarkets["candles"];
  readonly orderBook?: ResearchMarkets["orderBook"];
  readonly recentTrades?: ResearchMarkets["recentTrades"];
  readonly searchEvents?: ResearchMarkets["searchEvents"];
  readonly postContext?: ResearchPostContext;
}

async function setup(overrides: Overrides = {}) {
  const history = await openHistoryStore({ fs: createMemoryFileSystem(), path: "/d/h.json" });
  const markets: ResearchMarkets = {
    getEvent: overrides.getEvent ?? vi.fn(() => Promise.resolve(ok(fedEvent()))),
    searchEvents: overrides.searchEvents ?? vi.fn(() => Promise.resolve(ok({ events: otherEvents(), total: 3 }))),
    candles: overrides.candles ?? vi.fn(() => Promise.resolve(ok<readonly Candle[]>(hourlyCandles))),
    orderBook: overrides.orderBook ?? vi.fn(() => Promise.resolve(ok(book))),
    recentTrades: overrides.recentTrades ?? vi.fn(() => Promise.resolve(ok<readonly RecentTrade[]>(trades))),
  };
  const research = createResearch({ markets, history, nowMs: () => NOW, postContextFor: () => Promise.resolve(overrides.postContext) });
  return { research, history, markets };
}

const down = (): Promise<MarketsResult<never>> => Promise.resolve(fail({ kind: "http", status: 500 }));

describe("research view", () => {
  it("assembles a schema-valid view from live Gemini data", async () => {
    const { research } = await setup();
    const result = await research.view(SYMBOL, "1W");
    if (result.kind !== "ok") throw new Error(result.kind);
    const view = researchViewSchema.parse(JSON.parse(JSON.stringify(result.view)));
    expect(view.market).toMatchObject({
      eventTitle: "Title FED261211",
      contractLabel: "Fed maintains rate",
      category: "Economics",
      expiryDate: "2026-12-11T05:00:00.000Z",
      rulesText: "Rules for Fed maintains rate",
      volume: 1000,
      volume24h: 50,
    });
    expect(view.market.prices).toMatchObject({ buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38, bestBidCents: 60, bestAskCents: 62, lastTradeCents: 61 });
    expect(view.data).toEqual({ event: "live", candles: "live", book: "live", trades: "live" });
    expect(view.series.source).toBe("gemini");
    expect(view.series.points.length).toBeGreaterThan(20);
    expect(view.book.bids).toEqual([{ priceCents: 60, amount: 10, cumulative: 10 }, { priceCents: 59, amount: 5, cumulative: 15 }]);
    expect(view.trades).toEqual(trades);
    expect(view.indicators.averagePrice.value).not.toBeNull();
    expect(view.postContext).toBeNull();
  });

  it("lists sibling contracts and the lead contract of other events in the category", async () => {
    const { research } = await setup();
    const result = await research.view(SYMBOL, "1D");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.view.related.sameEvent.map((entry) => entry.symbol)).toEqual([OTHER]);
    expect(result.view.related.sameCategory).toEqual([
      { symbol: "GEMI-CPI261212-LOW", eventTitle: "Title CPI261212", contractLabel: "Low", yesCents: 70, noCents: 32 },
    ]);
  });

  it("requests the candle size for the chosen timeframe plus hourly candles for indicators", async () => {
    const candles = vi.fn<ResearchMarkets["candles"]>(() => Promise.resolve(ok<readonly Candle[]>([])));
    const { research } = await setup({ candles });
    await research.view(SYMBOL, "1H");
    expect(candles.mock.calls.map(([, timeframe]) => timeframe).sort()).toEqual(["1hr", "1m"]);
  });

  it("includes the matched post context", async () => {
    const postContext: ResearchPostContext = { source: "x-feed", text: "Powell signals a hold", author: "@Reuters", url: "https://x.com/a/status/1", why: "Powell hold", atMs: 1_800_000_000_000 };
    const { research } = await setup({ postContext });
    const result = await research.view(SYMBOL, "1D");
    expect(result.kind === "ok" && result.view.postContext).toEqual(postContext);
  });

  it("records the current price and watches the symbol", async () => {
    const { research, history } = await setup();
    await research.view(SYMBOL, "1D");
    expect(history.watched()).toEqual([SYMBOL]);
    expect(history.series(SYMBOL)).toEqual([{ atMs: NOW, yesCents: 62, bidCents: 60, askCents: 62 }]);
  });

  it("falls back to desk snapshots when Gemini candles are unavailable", async () => {
    const { research, history } = await setup({ candles: down, orderBook: down, recentTrades: down });
    history.watch(SYMBOL);
    history.record(SYMBOL, { atMs: NOW - 120_000, yesCents: 58, bidCents: 56, askCents: 58 });
    const result = await research.view(SYMBOL, "1H");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.view.data).toEqual({ event: "live", candles: "unavailable", book: "unavailable", trades: "unavailable" });
    expect(result.view.series.source).toBe("snapshot");
    expect(result.view.series.points.map((point) => point.cents)).toEqual([58, 62]);
    expect(result.view.book).toEqual({ bids: [], asks: [] });
    expect(result.view.trades).toEqual([]);
    expect(result.view.indicators.momentum.reading).toContain("Not enough trading yet");
  });

  it("has an empty series when there is neither candle nor snapshot data", async () => {
    const { research } = await setup({ candles: () => Promise.resolve(ok([])), getEvent: () => Promise.resolve(ok(event("FED261211", "Economics", [contract(SYMBOL, "Fed maintains rate", null, null)]))) });
    const result = await research.view(SYMBOL, "All");
    expect(result.kind === "ok" && result.view.series).toEqual({ source: "none", points: [] });
  });

  it("returns unknown-symbol for malformed symbols without calling Gemini", async () => {
    const { research, markets } = await setup();
    expect(await research.view("nope", "1D")).toEqual({ kind: "unknown-symbol" });
    expect(markets.getEvent).not.toHaveBeenCalled();
  });

  it("returns unknown-symbol when Gemini has no such event or contract", async () => {
    const missingEvent = await setup({ getEvent: () => Promise.resolve(fail({ kind: "http", status: 404 })) });
    expect(await missingEvent.research.view(SYMBOL, "1D")).toEqual({ kind: "unknown-symbol" });
    const missingContract = await setup({ getEvent: () => Promise.resolve(ok(event("FED261211", "Economics", [contract(OTHER, "Cut", 1, 1)]))) });
    expect(await missingContract.research.view(SYMBOL, "1D")).toEqual({ kind: "unknown-symbol" });
  });

  it("is unavailable when Gemini is down and nothing is known about the market", async () => {
    const { research, history } = await setup({ getEvent: down });
    expect(await research.view(SYMBOL, "1D")).toEqual({ kind: "unavailable" });
    expect(history.watched()).toEqual([]);
  });

  it("serves the last known market marked stale when Gemini goes down", async () => {
    let healthy = true;
    const { research, history } = await setup({ getEvent: () => (healthy ? Promise.resolve(ok(fedEvent())) : down()), candles: () => (healthy ? Promise.resolve(ok<readonly Candle[]>(hourlyCandles)) : down()) });
    await research.view(SYMBOL, "1D");
    healthy = false;
    history.watch(SYMBOL);
    history.record(SYMBOL, { atMs: NOW - 60_000, yesCents: 59, bidCents: null, askCents: null });
    const result = await research.view(SYMBOL, "1D");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.view.data.event).toBe("stale");
    expect(result.view.data.candles).toBe("unavailable");
    expect(result.view.market.eventTitle).toBe("Title FED261211");
    expect(result.view.series.points.at(-1)?.cents).toBe(62);
  });

  it("tolerates a failing related-markets search", async () => {
    const { research } = await setup({ searchEvents: down });
    const result = await research.view(SYMBOL, "1D");
    expect(result.kind === "ok" && result.view.related.sameCategory).toEqual([]);
  });

  it("falls back to the event description when the contract has none", async () => {
    const bare = { ...contract(SYMBOL, "Fed maintains rate", 62, 40), description: "" };
    const { research } = await setup({ getEvent: () => Promise.resolve(ok(event("FED261211", "Economics", [bare]))) });
    const result = await research.view(SYMBOL, "1D");
    expect(result.kind === "ok" && result.view.market.rulesText).toBe("Event description");
  });
});
