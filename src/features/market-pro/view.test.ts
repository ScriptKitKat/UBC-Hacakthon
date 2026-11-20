import { describe, expect, it } from "vitest";
import type { Candle, MarketEvent, MarketsResult, OrderBook, RecentTrade, SpotTicker } from "@/features/markets";
import type { DeskSnapshot, PositionsView } from "@/shared";
import { proLiveSchema, proShellSchema } from "@/shared";
import { createMarketPro } from "./view";
import type { MarketProDesk, MarketProMarkets } from "./view";

const SYMBOL = "GEMI-SOL261231-C200";
const NOW = Date.UTC(2026, 10, 19, 18, 0, 0);

function ok<T>(value: T): MarketsResult<T> {
  return { ok: true, value };
}

function contract(symbol: string, strike: number, yes: number): MarketEvent["contracts"][number] {
  return {
    instrumentSymbol: symbol as MarketEvent["contracts"][number]["instrumentSymbol"],
    label: `$${String(strike)}`,
    description: "",
    expiryDate: "2026-12-31T22:00:00.000Z",
    marketState: "open",
    status: "active",
    prices: {
      bestBidCents: yes - 1,
      bestAskCents: yes,
      lastTradeCents: yes,
      buyYesCents: yes,
      buyNoCents: 100 - yes,
      sellYesCents: yes - 1,
      sellNoCents: 100 - yes - 1,
    },
    limits: null,
    strikeValue: strike,
  };
}

const event: MarketEvent = {
  ticker: "SOL261231",
  title: "SOL above $200 by December 31?",
  category: "Crypto",
  status: "active",
  expiryDate: "2026-12-31T22:00:00.000Z",
  description: "Resolves on the SOL close.",
  subcategory: null,
  volume: 84000,
  volume24h: 12400,
  tags: [],
  contracts: [
    contract("GEMI-SOL261231-C150", 150, 88),
    contract(SYMBOL, 200, 62),
    contract("GEMI-SOL261231-C250", 250, 19),
  ],
};

const hourly: Candle[] = Array.from({ length: 48 }, (_, index) => ({
  timeMs: NOW - (47 - index) * 60 * 60 * 1000,
  openCents: 50,
  highCents: 55,
  lowCents: 48,
  closeCents: 50 + (index % 10),
  volume: 12,
}));

const book: OrderBook = {
  bids: [{ priceCents: 61, amount: 200 }, { priceCents: 60, amount: 400 }],
  asks: [{ priceCents: 63, amount: 250 }, { priceCents: 64, amount: 300 }],
};

const trades: RecentTrade[] = [
  { tradeId: 1, timeMs: NOW - 60_000, priceCents: 62, amount: 40, side: "buy" },
  { tradeId: 2, timeMs: NOW - 90_000, priceCents: 61, amount: 20, side: "sell" },
];

const snapshot: DeskSnapshot = {
  news: null,
  match: { kind: "no-news" },
  policy: {
    dailyCapCents: 2000,
    spentCents: 300,
    researchSpentCents: 0,
    remainingCents: 1700,
    autoApproveMaxCents: 200,
    perTradeMaxCents: 1000,
    killSwitch: false,
    marketAllowlist: [],
    marketCategories: [],
    senderAllowlist: ["priscilla"],
  },
  pending: [],
  log: [{
    entryId: "e1",
    kind: "approve",
    spokenReason: "ok",
    intentId: "i1",
    symbol: SYMBOL,
    outcome: "yes",
    notionalCents: 500,
    senderId: "priscilla",
    source: "desk",
    at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
  }],
  ledger: { configured: false, missing: [] },
};

const positions: PositionsView = {
  generatedAt: new Date(NOW).toISOString(),
  researchSpend: { todayCents: 0, purchases: [] },
  positions: [],
  totals: { costCents: 0, pricedCostCents: 0, valueCents: 0, pnlCents: 0, pnlPercent: null, unpricedPositions: 0 },
};

function markets(): MarketProMarkets {
  return {
    getEvent: (ticker) => Promise.resolve(ticker === "SOL261231" ? ok(event) : { ok: false, error: { kind: "http", status: 404 } }),
    candles: (symbol) => Promise.resolve(symbol === SYMBOL ? ok(hourly) : ok([])),
    orderBook: (symbol) => Promise.resolve(symbol === SYMBOL ? ok(book) : { ok: false, error: { kind: "http", status: 404 } }),
    recentTrades: (symbol) => Promise.resolve(symbol === SYMBOL ? ok(trades) : ok([])),
    pubticker: (pair) => Promise.resolve(pair === "solusd" ? ok<SpotTicker>({ last: 142.1 }) : { ok: false, error: { kind: "http", status: 404 } }),
  };
}

function desk(): MarketProDesk {
  return {
    getSnapshot: () => Promise.resolve(snapshot),
    getPositions: () => Promise.resolve(positions),
    matchedPostsFor: () => Promise.resolve([{ source: "x-feed", text: "Inflows picked up", author: "solanafloor", url: "https://x.com/s/1", why: "keyword", atMs: null }]),
  };
}

describe("createMarketPro", () => {
  it("builds a schema-valid shell with live stats, candles, a strike ladder, and a spot quote", async () => {
    const pro = createMarketPro({ markets: markets(), nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(true) });
    const result = await pro.shell(SYMBOL, "1D");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const shell = proShellSchema.parse(result.shell);
    expect(shell.watched).toBe(true);
    expect(shell.market.eventTicker).toBe("SOL261231");
    expect(shell.stats.openInterest.kind).toBe("unavailable");
    expect(shell.stats.traders.kind).toBe("unavailable");
    expect(shell.stats.maxPayout).toEqual({ kind: "value", text: "$1.00", tone: "neutral" });
    expect(shell.ladder).toHaveLength(3);
    expect(shell.ladder.filter((rung) => rung.current)).toHaveLength(1);
    expect(shell.spot?.asset).toBe("SOL");
    expect(shell.spot?.last).toBe(142.1);
    expect(shell.chart.candles.length).toBeGreaterThan(0);
    expect(shell.budget.senderId).toBe("priscilla");
    expect(shell.budget.remainingCents).toBe(1700);
  });

  it("builds a schema-valid live payload with the book, tape, indicators, flow, and feed", async () => {
    const pro = createMarketPro({ markets: markets(), nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    const result = await pro.live(SYMBOL, "1D");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const live = proLiveSchema.parse(result.live);
    expect(live.book.source).toBe("live");
    expect(live.book.midCents).toBe(62);
    expect(live.trades.items).toHaveLength(2);
    expect(live.indicators.length).toBeGreaterThan(0);
    expect(live.flow?.sampleSize).toBe(2);
    expect(live.feed.some((item) => item.source === "X @solanafloor")).toBe(true);
    expect(live.feed.some((item) => item.event.includes("Bought YES $5"))).toBe(true);
  });

  it("adds cached X chatter to the event feed", async () => {
    const chatter = [{ source: "x-search" as const, text: "SOL ETF talk heats up", author: "@solnews", url: "https://x.com/solnews/status/9", why: null, atMs: NOW - 60_000 }];
    const pro = createMarketPro({ markets: markets(), nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false), chatterFor: () => chatter });
    const result = await pro.live(SYMBOL, "1D");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.live.feed.find((item) => item.source === "X @solnews")).toMatchObject({ event: "SOL ETF talk heats up", url: "https://x.com/solnews/status/9", timeMs: NOW - 60_000 });
  });


  it("falls back to hourly candles when Gemini has no daily series", async () => {
    const hourlyOnly: MarketProMarkets = {
      ...markets(),
      candles: (symbol, timeframe) => {
        if (symbol === SYMBOL && timeframe === "1day") return Promise.resolve({ ok: false, error: { kind: "http", status: 400 } });
        if (symbol === SYMBOL) return Promise.resolve(ok(hourly));
        return Promise.resolve(ok([]));
      },
    };
    const pro = createMarketPro({ markets: hourlyOnly, nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    const result = await pro.shell(SYMBOL, "1D");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.shell.chart.source).toBe("live");
    expect(result.shell.chart.candles.length).toBeGreaterThan(0);
  });

  it("auto-picks 5m on a short-lived contract when five-minute history has enough trades", async () => {
    const soon = {
      ...event,
      expiryDate: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
      contracts: event.contracts.map((item) => ({ ...item, expiryDate: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() })),
    };
    const fiveMinute: Candle[] = Array.from({ length: 36 }, (_, index) => ({
      timeMs: NOW - (35 - index) * 5 * 60 * 1000,
      openCents: 50,
      highCents: 55,
      lowCents: 48,
      closeCents: 50 + (index % 10),
      volume: 4,
    }));
    const marketsSoon: MarketProMarkets = {
      ...markets(),
      getEvent: (ticker) => Promise.resolve(ticker === "SOL261231" ? ok(soon) : { ok: false, error: { kind: "http", status: 404 } }),
      candles: (symbol, timeframe) => {
        if (symbol !== SYMBOL) return Promise.resolve(ok([]));
        if (timeframe === "5m") return Promise.resolve(ok(fiveMinute));
        if (timeframe === "1hr") return Promise.resolve(ok(hourly));
        return Promise.resolve(ok([]));
      },
    };
    const pro = createMarketPro({ markets: marketsSoon, nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    const result = await pro.shell(SYMBOL);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.shell.chart.timeframe).toBe("5m");
    expect(result.shell.chart.candles.length).toBeGreaterThanOrEqual(20);
    expect(result.shell.chart.note).toBeNull();
  });

  it("falls back to the expiry default when no timeframe has enough traded candles", async () => {
    const soon = {
      ...event,
      expiryDate: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
      contracts: event.contracts.map((item) => ({ ...item, expiryDate: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() })),
    };
    const five = 5 * 60 * 1000;
    const sparse: Candle[] = [
      { timeMs: NOW - 4 * 60 * 60 * 1000, openCents: 72, highCents: 94, lowCents: 72, closeCents: 94, volume: 20 },
      { timeMs: NOW - 3 * 60 * 60 * 1000, openCents: 94, highCents: 94, lowCents: 89, closeCents: 89, volume: 8 },
      ...Array.from({ length: 20 }, (_, index) => ({
        timeMs: NOW - (19 - index) * five,
        openCents: 89,
        highCents: 89,
        lowCents: 89,
        closeCents: 89,
        volume: 0,
      })),
    ];
    const marketsSoon: MarketProMarkets = {
      ...markets(),
      getEvent: (ticker) => Promise.resolve(ticker === "SOL261231" ? ok(soon) : { ok: false, error: { kind: "http", status: 404 } }),
      candles: (symbol) => Promise.resolve(symbol === SYMBOL ? ok(sparse) : ok([])),
    };
    const pro = createMarketPro({ markets: marketsSoon, nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    const result = await pro.shell(SYMBOL);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.shell.chart.timeframe).toBe("5m");
    expect(result.shell.chart.candles).toHaveLength(2);
    expect(result.shell.chart.rsiLast).toBeNull();
    expect(result.shell.chart.note).toMatch(/not enough trading/i);
  });


  it("crops a sparse series to actual trades and withholds Bollinger and RSI", async () => {
    const five = 5 * 60 * 1000;
    const firstTrade = NOW - 16 * 60 * 60 * 1000;
    const lastTrade = NOW - 14 * 60 * 60 * 1000;
    const sparse: Candle[] = [
      ...Array.from({ length: 20 }, (_, index) => ({
        timeMs: firstTrade - (20 - index) * five,
        openCents: 72,
        highCents: 72,
        lowCents: 72,
        closeCents: 72,
        volume: 0,
      })),
      { timeMs: firstTrade, openCents: 72, highCents: 94, lowCents: 72, closeCents: 94, volume: 250 },
      { timeMs: firstTrade + five, openCents: 94, highCents: 94, lowCents: 91, closeCents: 91, volume: 4 },
      { timeMs: lastTrade, openCents: 91, highCents: 91, lowCents: 89, closeCents: 89, volume: 105 },
      ...Array.from({ length: 80 }, (_, index) => ({
        timeMs: lastTrade + (index + 1) * five,
        openCents: 89,
        highCents: 89,
        lowCents: 89,
        closeCents: 89,
        volume: 0,
      })),
    ];
    const marketsSparse: MarketProMarkets = {
      ...markets(),
      candles: (symbol) => Promise.resolve(symbol === SYMBOL ? ok(sparse) : ok([])),
    };
    const pro = createMarketPro({ markets: marketsSparse, nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    const result = await pro.shell(SYMBOL, "5m");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.shell.chart.candles[0]?.timeMs).toBe(firstTrade);
    expect(result.shell.chart.candles.at(-1)?.timeMs).toBe(lastTrade);
    expect(result.shell.chart.candles).toHaveLength(3);
    expect(result.shell.chart.rsiLast).toBeNull();
    expect(result.shell.chart.bbLower).toBeNull();
    expect(result.shell.chart.bbUpper).toBeNull();
    expect(result.shell.chart.note).toMatch(/not enough trading/i);
  });

  it("returns unknown-symbol for a malformed ticker and unavailable when Gemini is down", async () => {
    const missing = createMarketPro({ markets: markets(), nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    expect(await missing.shell("not-a-symbol", "1D")).toEqual({ kind: "unknown-symbol" });
    const down: MarketProMarkets = {
      ...markets(),
      getEvent: () => Promise.resolve({ ok: false, error: { kind: "network" } }),
    };
    const pro = createMarketPro({ markets: down, nowMs: () => NOW, desk: desk(), isWatched: () => Promise.resolve(false) });
    expect(await pro.shell(SYMBOL, "1D")).toEqual({ kind: "unavailable" });
  });
});
