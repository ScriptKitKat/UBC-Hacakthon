import { describe, expect, it } from "vitest";
import type { SpendEntry } from "@/features/journal";
import type { MarketContract, MarketEvent } from "@/features/markets";
import { instrumentSymbol } from "@/shared";
import { aggregatePositions, fillsFromJournal, markFromContract, summarizeResearchSpend, todaysResearchSpendCents } from "./positions";
import type { Fill, MarketMark } from "./positions";

const A = "GEMI-FED261211-MAINTAIN";
const B = "GEMI-FED261211-CUT25";

function fill(overrides: Partial<Fill> = {}): Fill {
  return {
    entryId: "e1",
    at: "2026-11-17T12:00:00.000Z",
    symbol: A,
    outcome: "yes",
    contracts: 2,
    costCents: 120,
    priceCents: 60,
    signature: "sig",
    explorerUrl: "https://explorer.test/tx/sig",
    ...overrides,
  };
}

const mark = (overrides: Partial<MarketMark> = {}): MarketMark => ({
  eventTitle: "Fed decision",
  contractLabel: "Maintain",
  status: "open",
  yesCents: 70,
  noCents: 28,
  markedAtMs: Date.parse("2026-11-18T00:00:00.000Z"),
  ...overrides,
});

const AT = "2026-11-18T00:00:00.000Z";

describe("aggregatePositions", () => {
  it("values a yes position at the sell price and computes unrealized pnl", () => {
    const view = aggregatePositions([fill()], new Map([[A, mark()]]), AT);
    expect(view.positions).toHaveLength(1);
    expect(view.positions[0]).toMatchObject({
      symbol: A,
      outcome: "yes",
      eventTitle: "Fed decision",
      contractLabel: "Maintain",
      contracts: 2,
      averageEntryCents: 60,
      costCents: 120,
      currentCents: 70,
      valueCents: 140,
      pnlCents: 20,
      status: "open",
    });
    expect(view.positions[0]?.pnlPercent).toBeCloseTo(16.67, 2);
    expect(view.totals).toMatchObject({ costCents: 120, pricedCostCents: 120, valueCents: 140, pnlCents: 20, unpricedPositions: 0 });
  });

  it("values a no position at the no sell price, never 100 minus yes", () => {
    const view = aggregatePositions([fill({ outcome: "no", contracts: 5, costCents: 100, priceCents: 40 })], new Map([[A, mark({ yesCents: 70, noCents: 25 })]]), AT);
    expect(view.positions[0]).toMatchObject({ currentCents: 25, valueCents: 125, pnlCents: 25, pnlPercent: 25 });
  });

  it("leaves a position unpriced when the no sell price is missing", () => {
    const view = aggregatePositions([fill({ outcome: "no" })], new Map([[A, mark({ noCents: null })]]), AT);
    expect(view.positions[0]).toMatchObject({ currentCents: null, valueCents: null, pnlCents: null, pnlPercent: null, status: "open" });
    expect(view.totals).toMatchObject({ costCents: 120, pricedCostCents: 0, valueCents: 0, pnlCents: 0, pnlPercent: null, unpricedPositions: 1 });
  });

  it("reports the age of the mark and ignores marks older than ten minutes", () => {
    const aged = (seconds: number) => new Map([[A, mark({ markedAtMs: Date.parse(AT) - seconds * 1000 })]]);
    expect(aggregatePositions([fill()], aged(90), AT).positions[0]).toMatchObject({ markAgeSeconds: 90, currentCents: 70 });
    const expired = aggregatePositions([fill()], aged(601), AT);
    expect(expired.positions[0]).toMatchObject({ markAgeSeconds: 601, currentCents: null, valueCents: null });
    expect(expired.totals.unpricedPositions).toBe(1);
  });

  it("marks positions without a market as unavailable", () => {
    const view = aggregatePositions([fill()], new Map(), AT);
    expect(view.positions[0]).toMatchObject({ status: "unavailable", currentCents: null, eventTitle: null });
  });

  it("combines fills for the same symbol and outcome with a weighted average entry", () => {
    const fills = [
      fill({ entryId: "e1", at: "2026-11-17T12:00:00.000Z", contracts: 1, costCents: 50, priceCents: 50 }),
      fill({ entryId: "e2", at: "2026-11-17T13:00:00.000Z", contracts: 3, costCents: 210, priceCents: 70 }),
    ];
    const position = aggregatePositions(fills, new Map([[A, mark({ yesCents: 80 })]]), AT).positions[0];
    expect(position).toMatchObject({ contracts: 4, costCents: 260, averageEntryCents: 65, valueCents: 320, pnlCents: 60 });
    expect(position?.fills.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  it("keeps yes and no on the same market as separate positions and orders by latest fill", () => {
    const fills = [
      fill({ entryId: "e1", at: "2026-11-17T10:00:00.000Z", outcome: "yes" }),
      fill({ entryId: "e2", at: "2026-11-17T14:00:00.000Z", outcome: "no" }),
      fill({ entryId: "e3", at: "2026-11-17T12:00:00.000Z", symbol: B }),
    ];
    const view = aggregatePositions(fills, new Map([[A, mark()], [B, mark()]]), AT);
    expect(view.positions.map((position) => `${position.symbol}:${position.outcome}`)).toEqual([`${A}:no`, `${B}:yes`, `${A}:yes`]);
  });

  it("totals only priced positions toward pnl", () => {
    const fills = [fill({ entryId: "e1" }), fill({ entryId: "e2", symbol: B, costCents: 300, contracts: 5, priceCents: 60 })];
    const view = aggregatePositions(fills, new Map([[A, mark({ yesCents: 50 })]]), AT);
    expect(view.totals).toMatchObject({ costCents: 420, pricedCostCents: 120, valueCents: 100, pnlCents: -20, unpricedPositions: 1 });
    expect(view.totals.pnlPercent).toBeCloseTo(-16.67, 2);
  });

  it("returns empty totals with no fills", () => {
    expect(aggregatePositions([], new Map(), AT)).toEqual({
      generatedAt: AT,
      positions: [],
      totals: { costCents: 0, pricedCostCents: 0, valueCents: 0, pnlCents: 0, pnlPercent: null, unpricedPositions: 0 },
    });
  });

  it("pays winners 100¢ and losers 0¢ once settled", () => {
    const view = aggregatePositions([fill()], new Map([[A, mark({ status: "settled", yesCents: 100, noCents: 0 })]]), AT);
    expect(view.positions[0]).toMatchObject({ status: "settled", valueCents: 200, pnlCents: 80 });
  });

  it("rounds fractional-cent values to hundredths", () => {
    const view = aggregatePositions([fill({ contracts: 1.61, costCents: 100, priceCents: 62 })], new Map([[A, mark({ yesCents: 61 })]]), AT);
    expect(view.positions[0]).toMatchObject({ valueCents: 98.21, pnlCents: -1.79, averageEntryCents: 62 });
  });
});

function entry(overrides: Partial<SpendEntry> = {}): SpendEntry {
  return {
    operationId: "e1",
    kind: "trade",
    status: "settled",
    notionalCents: 100,
    symbol: A,
    outcome: "yes",
    senderId: "priscilla",
    source: "feed",
    reservedAt: "2026-11-17T11:59:00.000Z",
    resolvedAt: "2026-11-17T12:00:00.000Z",
    signature: "sig",
    explorerUrl: "https://explorer.test/tx/sig",
    ticket: { ticketId: "t1", symbol: A, outcome: "yes", quantity: "1.61", price: "0.62", mode: "paper" },
    ...overrides,
  };
}

function omit(source: SpendEntry, key: "ticket" | "signature" | "explorerUrl"): SpendEntry {
  const copy = structuredClone(source);
  Reflect.deleteProperty(copy, key);
  return copy;
}

describe("fillsFromJournal", () => {
  it("turns settled trades into fills with cents prices, stamped when the payment settled", () => {
    expect(fillsFromJournal([entry()])).toEqual([
      { entryId: "e1", at: "2026-11-17T12:00:00.000Z", symbol: A, outcome: "yes", contracts: 1.61, costCents: 100, priceCents: 62, signature: "sig", explorerUrl: "https://explorer.test/tx/sig" },
    ]);
  });

  it("ignores reserved and failed payments, research purchases and trades without a ticket", () => {
    const journal = [entry({ status: "reserved" }), entry({ status: "failed" }), entry({ kind: "research", outcome: null }), omit(entry(), "ticket")];
    expect(fillsFromJournal(journal)).toEqual([]);
  });

  it("skips tickets with unreadable quantities or prices", () => {
    const bad = (quantity: string, price: string) => entry({ ticket: { ticketId: "t", symbol: A, outcome: "yes", quantity, price, mode: "paper" } });
    expect(fillsFromJournal([bad("abc", "0.62"), bad("1", "x"), bad("0", "0.5"), bad("1", "0")])).toEqual([]);
  });

  it("uses null proof fields when the ledger gave none", () => {
    const unsigned = omit(omit(entry(), "signature"), "explorerUrl");
    expect(fillsFromJournal([unsigned])[0]).toMatchObject({ signature: null, explorerUrl: null });
  });

  it("keeps every settled fill no matter how many other operations the journal holds", () => {
    const noise = Array.from({ length: 1500 }, (_, index) => entry({ operationId: `r${String(index)}`, status: "failed" }));
    expect(fillsFromJournal([...noise, entry()])).toHaveLength(1);
  });
});

function omitResolved(source: SpendEntry): SpendEntry {
  const copy = structuredClone(source);
  Reflect.deleteProperty(copy, "resolvedAt");
  return copy;
}

describe("research spend", () => {
  const research = (overrides: Partial<SpendEntry>) => omit(entry({ kind: "research", outcome: null, symbol: A, notionalCents: 5, ...overrides }), "ticket");

  it("sums today's settled research only and lists newest purchases first", () => {
    const journal = [
      research({ operationId: "old", resolvedAt: "2026-11-17T10:00:00.000Z" }),
      research({ operationId: "new", resolvedAt: "2026-11-18T10:00:00.000Z" }),
      omitResolved(research({ operationId: "held", status: "reserved" })),
      entry(),
    ];
    const summary = summarizeResearchSpend(journal, "2026-11-18T12:00:00.000Z");
    expect(summary.todayCents).toBe(5);
    expect(summary.purchases.map((purchase) => purchase.entryId)).toEqual(["new", "old"]);
    expect(todaysResearchSpendCents(journal, "2026-11-17")).toBe(5);
  });
});

function contract(overrides: Partial<MarketContract> = {}): MarketContract {
  return {
    instrumentSymbol: instrumentSymbol(A),
    label: "Maintain",
    description: "",
    expiryDate: null,
    marketState: "open",
    status: "active",
    prices: { bestBidCents: 58, bestAskCents: 62, lastTradeCents: 61, buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38 },
    limits: null,
    ...overrides,
  };
}

const event = (status = "active"): MarketEvent => ({
  ticker: "FED261211", title: "Fed decision", category: "Economics", status, expiryDate: null, description: "", subcategory: null, volume: null, volume24h: null, tags: [], contracts: [],
});

describe("markFromContract", () => {
  it("values at the sell prices of an open market", () => {
    expect(markFromContract(event(), contract(), 5)).toEqual({ eventTitle: "Fed decision", contractLabel: "Maintain", status: "open", yesCents: 60, noCents: 38, markedAtMs: 5 });
  });

  it("never falls back to the best bid or last trade when a sell quote is missing", () => {
    const noSell = contract({ prices: { ...contract().prices, sellYesCents: null, sellNoCents: null } });
    expect(markFromContract(event(), noSell, 0)).toMatchObject({ yesCents: null, noCents: null });
  });

  it("leaves a settled contract with unknown resolution unpriced", () => {
    expect(markFromContract(event("settled"), contract(), 0)).toMatchObject({ status: "settled", yesCents: null, noCents: null });
  });

  it("reports closed markets", () => {
    expect(markFromContract(event(), contract({ marketState: "closed" }), 0).status).toBe("closed");
    expect(markFromContract(event("closed"), contract(), 0).status).toBe("closed");
  });

  it("settles to the resolution side", () => {
    expect(markFromContract(event("settled"), contract({ status: "settled", marketState: "closed", resolutionSide: "no" }), 0)).toMatchObject({ status: "settled", yesCents: 0, noCents: 100 });
    expect(markFromContract(event("settled"), contract({ status: "settled", marketState: "closed", resolutionSide: "yes" }), 0)).toMatchObject({ yesCents: 100, noCents: 0 });
  });
});
