import { describe, expect, it } from "vitest";
import type { OrderBook } from "@/features/markets";
import type { DecisionLogEntry, PositionView } from "@/shared";
import { buildBook, slippageForNotional } from "./book";
import { oddsChangeAfter } from "./feed";
import { buildFeed } from "./feed";
import { flowFromTrades } from "./flow";
import { strikeLadder } from "./ladder";
import { positionFor } from "./position";
import { buildSpot } from "./spot";
import { buildStats, formatResolvesIn } from "./stats";
import { cappedStakeCents, needsApproval, ticketQuote } from "./ticket";
import type { MarketEvent } from "@/features/markets";

const book: OrderBook = {
  asks: [
    { priceCents: 63, amount: 200 },
    { priceCents: 64, amount: 400 },
    { priceCents: 70, amount: 800 },
  ],
  bids: [
    { priceCents: 61, amount: 100 },
    { priceCents: 60, amount: 500 },
  ],
};

describe("book", () => {
  it("reports mid, spread, depth within 5 cents, and slippage for a $500 buy", () => {
    const view = buildBook(book);
    expect(view.midCents).toBe(62);
    expect(view.spreadCents).toBe(2);
    expect(view.source).toBe("live");
    expect(view.depthPlusMinus5).toBeCloseTo(0.63 * 200 + 0.64 * 400 + 0.61 * 100 + 0.6 * 500);
    const slippage = slippageForNotional(book.asks, 500);
    expect(slippage).not.toBeNull();
    expect(slippage ?? 0).toBeGreaterThan(0);
  });

  it("returns unavailable when Gemini has no book", () => {
    expect(buildBook(null).source).toBe("unavailable");
    expect(slippageForNotional([], 500)).toBeNull();
  });
});

describe("ticketQuote", () => {
  it("computes shares, max payout, break-even, EV, and a Kelly stake capped at $10", () => {
    const quote = ticketQuote({ priceCents: 63, stakeCents: 500, believedYesPercent: 68, side: "yes" });
    if (quote.kind === "invalid") throw new Error("expected a quote");
    expect(quote.shares).toBeCloseTo(500 / 63);
    expect(quote.maxPayoutCents).toBeCloseTo(quote.shares * 100);
    expect(quote.breakEvenPercent).toBe(63);
    expect(quote.evCents).toBeGreaterThan(0);
    expect(quote.kellyFraction).toBeCloseTo((0.68 - 0.63) / (1 - 0.63));
    expect(quote.kellyStakeCents).toBeCloseTo(quote.kellyFraction * 1000);
    expect(quote.kellyStakeCents).toBeLessThanOrEqual(1000);
  });

  it("returns no Kelly stake when the believed probability is below the price", () => {
    const quote = ticketQuote({ priceCents: 63, stakeCents: 500, believedYesPercent: 50, side: "yes" });
    if (quote.kind === "invalid") throw new Error("expected a quote");
    expect(quote.kellyFraction).toBe(0);
    expect(quote.kellyStakeCents).toBe(0);
    expect(quote.evCents).toBeLessThan(0);
  });
});

describe("cappedStakeCents and needsApproval", () => {
  it("caps a stake to the remaining daily budget and the per-trade max", () => {
    expect(cappedStakeCents(1500, 700, 1000)).toBe(700);
    expect(cappedStakeCents(1500, 2000, 1000)).toBe(1000);
    expect(needsApproval(500, 200)).toBe(true);
    expect(needsApproval(200, 200)).toBe(false);
  });
});

describe("buildStats", () => {
  it("hides open interest and traders, and formats a 24h move from hourly candles", () => {
    const now = Date.UTC(2026, 10, 19, 18);
    const hourly = Array.from({ length: 24 }, (_, index) => ({
      timeMs: now - (23 - index) * 60 * 60 * 1000,
      openCents: 50,
      highCents: index === 10 ? 63 : 55,
      lowCents: index === 2 ? 48 : 50,
      closeCents: 50 + index * 0.5,
      volume: 10,
    }));
    const stats = buildStats({
      prices: { bestBidCents: 61, bestAskCents: 63, lastTradeCents: 62, buyYesCents: 63, buyNoCents: 39, sellYesCents: 61, sellNoCents: 37 },
      hourly,
      volume: 84000,
      volume24h: 12400,
      expiryDate: new Date(now + 42 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000).toISOString(),
      nowMs: now,
    });
    expect(stats.last).toEqual({ kind: "value", text: "62¢", tone: "neutral" });
    expect(stats.change24h.kind).toBe("value");
    if (stats.change24h.kind === "value") expect(stats.change24h.tone).toBe("up");
    expect(stats.openInterest).toMatchObject({ kind: "unavailable" });
    expect(stats.traders).toMatchObject({ kind: "unavailable" });
    expect(stats.maxPayout).toEqual({ kind: "value", text: "$1.00", tone: "neutral" });
    expect(stats.resolvesIn).toEqual({ kind: "value", text: "42d 10h", tone: "neutral" });
  });

  it("still reports a positive 24h change when Gemini returns newest candles first", () => {
    const now = Date.UTC(2026, 10, 19, 18);
    const newestFirst = Array.from({ length: 19 }, (_, index) => {
      const age = index;
      const close = index === 18 ? 72 : 89;
      return {
        timeMs: now - age * 60 * 60 * 1000,
        openCents: close,
        highCents: 94,
        lowCents: 72,
        closeCents: close,
        volume: 10,
      };
    });
    const stats = buildStats({
      prices: { bestBidCents: 90, bestAskCents: 94, lastTradeCents: 89, buyYesCents: 94, buyNoCents: 10, sellYesCents: 90, sellNoCents: 6 },
      hourly: newestFirst,
      volume: 46800,
      volume24h: 46800,
      expiryDate: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      nowMs: now,
    });
    expect(stats.change24h).toEqual({ kind: "value", text: "+17", tone: "up" });
  });

  it("says a market has ended when the expiry is in the past", () => {
    const stat = formatResolvesIn("2020-01-01T00:00:00.000Z", Date.UTC(2026, 10, 19));
    expect(stat).toEqual({ kind: "value", text: "Ended", tone: "neutral" });
  });
});

describe("strikeLadder", () => {
  it("orders contracts by strike and marks the current one", () => {
    const contract = (symbol: string, strike: number, yes: number): MarketEvent["contracts"][number] => ({
      instrumentSymbol: symbol as MarketEvent["contracts"][number]["instrumentSymbol"],
      label: String(strike),
      description: "",
      expiryDate: null,
      marketState: "open",
      status: "active",
      prices: { bestBidCents: yes - 1, bestAskCents: yes, lastTradeCents: yes, buyYesCents: yes, buyNoCents: 100 - yes, sellYesCents: yes - 1, sellNoCents: 100 - yes - 1 },
      limits: null,
      strikeValue: strike,
    });
    const event = {
      ticker: "SOL261231",
      title: "SOL above a strike by Dec 31?",
      category: "Crypto",
      status: "active",
      expiryDate: null,
      description: "",
      subcategory: null,
      volume: 1,
      volume24h: 1,
      tags: [],
      contracts: [contract("GEMI-SOL261231-C200", 200, 62), contract("GEMI-SOL261231-C150", 150, 88), contract("GEMI-SOL261231-C250", 250, 19)],
    } as unknown as MarketEvent;
    const ladder = strikeLadder(event, "GEMI-SOL261231-C200");
    expect(ladder.map((rung) => rung.strikeLabel)).toEqual(["$150", "$200", "$250"]);
    expect(ladder[1]?.current).toBe(true);
    expect(ladder[0]?.current).toBe(false);
  });
});

describe("flow, feed, spot, position", () => {
  it("splits recent prints into buy and sell share and counts large trades", () => {
    const flow = flowFromTrades([
      { tradeId: 1, timeMs: 1, priceCents: 50, amount: 10, side: "buy" },
      { tradeId: 2, timeMs: 2, priceCents: 50, amount: 30, side: "sell" },
      { tradeId: 3, timeMs: 3, priceCents: 50, amount: 4000, side: "buy" },
    ]);
    expect(flow?.buyPercent).toBeGreaterThan(50);
    expect(flow?.largeTradeCount).toBe(1);
    expect(flow?.sampleSize).toBe(3);
  });

  it("measures the odds change one hour after an event from candles", () => {
    const hour = 60 * 60 * 1000;
    const start = 1_000_000;
    const change = oddsChangeAfter([
      { timeMs: start, openCents: 50, highCents: 50, lowCents: 50, closeCents: 50, volume: 1 },
      { timeMs: start + hour, openCents: 55, highCents: 55, lowCents: 55, closeCents: 55, volume: 1 },
    ], start);
    expect(change).toBe(5);
  });

  it("includes matched posts and desk fills in the event feed", () => {
    const entry: DecisionLogEntry = {
      entryId: "e1",
      kind: "approve",
      spokenReason: "ok",
      intentId: "i1",
      symbol: "GEMI-SOL-C200",
      outcome: "yes",
      notionalCents: 500,
      senderId: "priscilla",
      source: "desk",
      at: "2026-11-19T18:00:00.000Z",
    };
    const items = buildFeed({
      log: [entry],
      symbol: "GEMI-SOL-C200",
      post: { source: "x-feed", text: "Inflows are up", author: "solanafloor", url: "https://x.com/s/1", why: "keyword" },
      candles: [],
      nowMs: Date.parse("2026-11-19T19:00:00.000Z"),
    });
    expect(items.some((item) => item.source === "X @solanafloor")).toBe(true);
    expect(items.some((item) => item.event.includes("Bought YES $5"))).toBe(true);
  });

  it("computes move needed from a live spot price and strike, and skips non-crypto events", () => {
    const event = {
      ticker: "SOL261231",
      title: "SOL above $200?",
      category: "Crypto",
      status: "active",
      expiryDate: null,
      description: "",
      subcategory: null,
      volume: null,
      volume24h: null,
      tags: [],
      contracts: [{
        instrumentSymbol: "GEMI-SOL261231-C200" as MarketEvent["contracts"][number]["instrumentSymbol"],
        label: "200",
        description: "",
        expiryDate: null,
        marketState: "open",
        status: "active",
        prices: { bestBidCents: 61, bestAskCents: 63, lastTradeCents: 62, buyYesCents: 63, buyNoCents: 39, sellYesCents: 61, sellNoCents: 37 },
        limits: null,
        strikeValue: 200,
      }],
    } as unknown as MarketEvent;
    const spot = buildSpot({ event, symbol: "GEMI-SOL261231-C200", last: 142.1 });
    expect(spot?.asset).toBe("SOL");
    expect(spot?.moveNeeded).toBeCloseTo((200 - 142.1) / 142.1);
    expect(buildSpot({ event: { ...event, category: "Sports" }, symbol: "GEMI-SOL261231-C200", last: 142.1 })).toBeNull();
  });

  it("computes if-yes and if-no payouts from an open paper position", () => {
    const held = {
      symbol: "GEMI-SOL-C200",
      outcome: "yes",
      eventTitle: "SOL",
      contractLabel: "200",
      contracts: 4.17,
      averageEntryCents: 48,
      costCents: 200,
      currentCents: 61,
      markAgeSeconds: 0,
      valueCents: 254,
      pnlCents: 54,
      pnlPercent: 27,
      status: "open",
      fills: [],
    } satisfies PositionView;
    const position = positionFor([held], "GEMI-SOL-C200");
    expect(position?.ifYesCents).toBeCloseTo(4.17 * 100 - 200);
    expect(position?.ifNoCents).toBe(-200);
    expect(positionFor([held], "GEMI-OTHER")).toBeNull();
  });
});
