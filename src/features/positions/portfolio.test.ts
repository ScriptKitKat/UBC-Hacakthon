import { describe, expect, it } from "vitest";
import { portfolioViewSchema } from "@/shared";
import type { SpendEntry } from "@/features/journal";
import { activityCsv, buildPortfolio, formatPolicyDayLabel, formatPolicyReset, MIN_CALIBRATION_BETS, policyDayUtc, rangeWindow } from "./portfolio";
import type { PortfolioInputs, PortfolioMarket } from "./portfolio";

const NOW = Date.parse("2026-11-19T21:00:00.000Z");
const FED = "GEMI-FED261211-MAINTAIN";
const SOL = "GEMI-SOL261231-C200";
const BTC = "GEMI-BTC2611192200-HI61500";

function entry(overrides: Partial<SpendEntry> & Pick<SpendEntry, "operationId" | "kind" | "symbol" | "notionalCents" | "reservedAt">): SpendEntry {
  const ticket = overrides.kind === "trade"
    ? overrides.ticket ?? {
        ticketId: `t-${overrides.operationId}`,
        symbol: overrides.symbol,
        outcome: overrides.outcome ?? "yes",
        quantity: "1",
        price: "0.50",
        mode: "paper" as const,
      }
    : overrides.ticket;
  return {
    operationId: overrides.operationId,
    kind: overrides.kind,
    status: overrides.status ?? "settled",
    notionalCents: overrides.notionalCents,
    symbol: overrides.symbol,
    outcome: overrides.outcome ?? (overrides.kind === "trade" ? "yes" : null),
    senderId: overrides.senderId ?? "priscilla",
    source: overrides.source ?? "desk",
    reservedAt: overrides.reservedAt,
    ...(overrides.resolvedAt !== undefined ? { resolvedAt: overrides.resolvedAt } : { resolvedAt: overrides.reservedAt }),
    ...(overrides.signature !== undefined ? { signature: overrides.signature } : { signature: `sig-${overrides.operationId}` }),
    ...(overrides.explorerUrl !== undefined
      ? { explorerUrl: overrides.explorerUrl }
      : { explorerUrl: `https://explorer.solana.com/tx/sig-${overrides.operationId}?cluster=devnet` }),
    ...(ticket !== undefined ? { ticket } : {}),
  };
}

function market(overrides: Partial<PortfolioMarket> & { readonly symbol?: string } = {}): PortfolioMarket {
  return {
    eventTitle: overrides.eventTitle ?? "Fed decision in December?",
    contractLabel: overrides.contractLabel ?? "Maintain",
    category: overrides.category ?? "Economics",
    expiryDate: overrides.expiryDate ?? "2026-12-11T05:00:00.000Z",
    status: overrides.status ?? "open",
    yesCents: overrides.yesCents ?? 62,
    noCents: overrides.noCents ?? 36,
    markedAtMs: overrides.markedAtMs ?? NOW,
  };
}

function inputs(overrides: Partial<PortfolioInputs> = {}): PortfolioInputs {
  return {
    entries: [],
    markets: new Map(),
    history: new Map(),
    candles: new Map(),
    dailyCapCents: 2000,
    range: "30d",
    nowMs: NOW,
    ...overrides,
  };
}

describe("rangeWindow and policy days", () => {
  it("opens 7d, 30d, and 90d windows back from now, and All from the earliest fill", () => {
    expect(rangeWindow("7d", NOW, null).startMs).toBe(NOW - 7 * 24 * 60 * 60 * 1000);
    expect(rangeWindow("30d", NOW, null).startMs).toBe(NOW - 30 * 24 * 60 * 60 * 1000);
    expect(rangeWindow("90d", NOW, null).startMs).toBe(NOW - 90 * 24 * 60 * 60 * 1000);
    const first = Date.parse("2026-10-20T15:00:00.000Z");
    expect(rangeWindow("all", NOW, first).startMs).toBe(first);
  });

  it("labels a UTC policy day by the 6:00 PM CST start", () => {
    expect(policyDayUtc(Date.parse("2026-11-13T00:00:00.000Z"))).toBe("2026-11-13");
    expect(formatPolicyDayLabel("2026-11-13")).toBe("Nov 12");
  });

  it("states the reset time in Central Time for the season", () => {
    expect(formatPolicyReset(Date.parse("2026-11-19T12:00:00.000Z"))).toBe("Days reset at 6:00 PM CST.");
    expect(formatPolicyReset(Date.parse("2026-07-01T12:00:00.000Z"))).toBe("Days reset at 7:00 PM CDT.");
  });
});

describe("buildPortfolio", () => {
  it("names no busiest day when nothing was spent", () => {
    const view = buildPortfolio(inputs());
    expect(view.dailySpend.caption).toBe("No spend in this window");
    expect(view.dailySpend.resetNote).toBe(formatPolicyReset(NOW));
  });

  const openSol = entry({
    operationId: "sol-1",
    kind: "trade",
    symbol: SOL,
    notionalCents: 200,
    reservedAt: "2026-11-12T18:00:00.000Z",
    outcome: "yes",
    ticket: { ticketId: "tk-sol", symbol: SOL, outcome: "yes", quantity: "4.17", price: "0.48", mode: "paper" },
  });
  const brief = entry({
    operationId: "brief-1",
    kind: "research",
    symbol: FED,
    notionalCents: 5,
    reservedAt: "2026-11-19T14:40:00.000Z",
    outcome: null,
  });

  it("marks an open position to the live bid and includes research spend", () => {
    const view = portfolioViewSchema.parse(buildPortfolio(inputs({
      entries: [openSol, brief],
      markets: new Map([
        [SOL, market({ eventTitle: "SOL above $200 by Dec 31?", category: "Crypto", expiryDate: "2026-12-31T22:00:00.000Z", yesCents: 61 })],
        [FED, market()],
      ]),
    })));
    expect(view.stats.openValue.valueCents).toBe(254.37);
    expect(view.stats.totalPnl.valueCents).toBe(54.37);
    expect(view.stats.researchSpend.valueCents).toBe(5);
    expect(view.stats.researchSpend.detail).toBe("1 brief");
    expect(view.openPositions.rows).toHaveLength(1);
    expect(view.openPositions.rows[0]).toMatchObject({ shares: 4.17, averageEntryCents: 48, markCents: 61, ifRightCents: 417, ends: "Dec 31" });
    expect(view.activity.map((row) => row.type)).toEqual(["brief", "bet"]);
    expect(view.activity[1]?.ticket?.ticketId).toBe("tk-sol");
    expect(view.activity[1]?.explorerUrl).toContain("cluster=devnet");
    expect(view.calibration.empty).toContain("at least 5");
  });

  it("computes realized P/L and win rate from settled contracts", () => {
    const win = entry({
      operationId: "win",
      kind: "trade",
      symbol: FED,
      notionalCents: 400,
      reservedAt: "2026-11-10T12:00:00.000Z",
      outcome: "yes",
      ticket: { ticketId: "tk-win", symbol: FED, outcome: "yes", quantity: "8", price: "0.50", mode: "paper" },
    });
    const loss = entry({
      operationId: "loss",
      kind: "trade",
      symbol: BTC,
      notionalCents: 300,
      reservedAt: "2026-11-11T12:00:00.000Z",
      outcome: "yes",
      ticket: { ticketId: "tk-loss", symbol: BTC, outcome: "yes", quantity: "5", price: "0.60", mode: "paper" },
    });
    const view = buildPortfolio(inputs({
      entries: [win, loss],
      markets: new Map([
        [FED, market({ status: "settled", yesCents: 100, noCents: 0, expiryDate: "2026-11-15T05:00:00.000Z", category: "Economics" })],
        [BTC, market({ eventTitle: "Bitcoin price today?", status: "settled", yesCents: 0, noCents: 100, expiryDate: "2026-11-16T05:00:00.000Z", category: "Crypto" })],
      ]),
    }));
    expect(view.stats.realizedPnl.valueCents).toBe(100);
    expect(view.stats.winRate).toMatchObject({ wins: 1, settled: 2, percent: 50 });
    expect(view.stats.totalPnl.valueCents).toBe(100);
    expect(view.activity.some((row) => row.type === "payout" && row.amountCents === 800)).toBe(true);
    expect(view.categories.rows).toEqual(expect.arrayContaining([
      { category: "Economics", pnlCents: 400 },
      { category: "Crypto", pnlCents: -300 },
    ]));
  });

  it("rebuilds the P/L series from candles and carries the last mark when a day has no candle", () => {
    const fill = entry({
      operationId: "open-1",
      kind: "trade",
      symbol: SOL,
      notionalCents: 200,
      reservedAt: "2026-11-17T12:00:00.000Z",
      ticket: { ticketId: "tk", symbol: SOL, outcome: "yes", quantity: "4", price: "0.50", mode: "paper" },
    });
    const view = buildPortfolio(inputs({
      range: "7d",
      entries: [fill],
      markets: new Map([[SOL, market({ eventTitle: "SOL", category: "Crypto", yesCents: 80, expiryDate: "2026-12-31T00:00:00.000Z" })]]),
      candles: new Map([[SOL, [{ timeMs: Date.parse("2026-11-17T00:00:00.000Z"), openCents: 50, highCents: 55, lowCents: 50, closeCents: 55, volume: 1 }]]]),
    }));
    const afterFill = view.pnlSeries.filter((point) => Date.parse(point.at) >= Date.parse("2026-11-17T12:00:00.000Z"));
    expect(afterFill.length).toBeGreaterThan(0);
    const first = afterFill[0];
    expect(first?.totalPnlCents).toBe(20);
    expect(first?.carried).toBe(false);
    const today = afterFill.at(-1);
    expect(today?.label).toBe("Today");
    expect(today?.totalPnlCents).toBe(120);
    expect(today?.carried).toBe(false);
    expect(view.marksNote).toBeNull();

    const carried = buildPortfolio(inputs({
      range: "7d",
      entries: [fill],
      markets: new Map([[SOL, market({ eventTitle: "SOL", category: "Crypto", yesCents: 80, expiryDate: "2026-12-31T00:00:00.000Z" })]]),
    }));
    const beforeToday = carried.pnlSeries.filter((point) => point.label !== "Today" && Date.parse(point.at) >= Date.parse("2026-11-17T12:00:00.000Z"));
    expect(beforeToday.every((point) => point.carried && point.totalPnlCents === 120)).toBe(true);
    expect(carried.marksNote).toMatch(/last known mark/i);
  });

  it("withholds calibration until five settled bets and then buckets entry price vs win rate", () => {
    const bets = Array.from({ length: 5 }, (_, index) => entry({
      operationId: `c-${String(index)}`,
      kind: "trade",
      symbol: `${FED}-${String(index)}`,
      notionalCents: 100,
      reservedAt: `2026-11-1${String(index)}T12:00:00.000Z`,
      ticket: {
        ticketId: `tk-c-${String(index)}`,
        symbol: `${FED}-${String(index)}`,
        outcome: "yes",
        quantity: "2",
        price: index < 3 ? "0.30" : "0.70",
        mode: "paper",
      },
    }));
    const tooFew = buildPortfolio(inputs({
      entries: bets.slice(0, 4),
      markets: new Map(bets.slice(0, 4).map((item) => [item.symbol, market({ status: "settled", yesCents: 100, noCents: 0, expiryDate: "2026-11-18T00:00:00.000Z" })])),
    }));
    expect(tooFew.calibration.settledBets).toBe(4);
    expect(tooFew.calibration.empty).toContain(String(MIN_CALIBRATION_BETS));
    expect(tooFew.calibration.buckets).toEqual([]);

    const markets = new Map(bets.map((item, index) => [
      item.symbol,
      market({ status: "settled", yesCents: index === 0 || index >= 3 ? 100 : 0, noCents: index === 0 || index >= 3 ? 0 : 100, expiryDate: "2026-11-18T00:00:00.000Z" }),
    ]));
    const view = buildPortfolio(inputs({ entries: bets, markets }));
    expect(view.calibration.empty).toBeNull();
    expect(view.calibration.buckets).toEqual([
      expect.objectContaining({ label: "Paid 20–40¢", bets: 3, wins: 1, winRatePercent: 33, impliedPercent: 30 }),
      expect.objectContaining({ label: "Paid 60–80¢", bets: 2, wins: 2, winRatePercent: 100, impliedPercent: 70 }),
    ]);
  });

  it("filters activity and research to the selected range", () => {
    const oldBrief = entry({ operationId: "old", kind: "research", symbol: FED, notionalCents: 5, reservedAt: "2026-09-01T00:00:00.000Z" });
    const recent = entry({ operationId: "new", kind: "research", symbol: FED, notionalCents: 5, reservedAt: "2026-11-18T00:00:00.000Z" });
    const month = buildPortfolio(inputs({ entries: [oldBrief, recent], markets: new Map([[FED, market()]]), range: "30d" }));
    const all = buildPortfolio(inputs({ entries: [oldBrief, recent], markets: new Map([[FED, market()]]), range: "all" }));
    expect(month.stats.researchSpend.valueCents).toBe(5);
    expect(month.activity).toHaveLength(1);
    expect(all.stats.researchSpend.valueCents).toBe(10);
    expect(all.activity).toHaveLength(2);
  });

  it("caps daily spend bars at 14 days and names the busiest day against the $20 cap", () => {
    const entries = [
      entry({ operationId: "busy-bet", kind: "trade", symbol: SOL, notionalCents: 800, reservedAt: "2026-11-13T01:00:00.000Z", ticket: { ticketId: "tk-b", symbol: SOL, outcome: "yes", quantity: "16", price: "0.50", mode: "paper" } }),
      entry({ operationId: "busy-brief", kind: "research", symbol: FED, notionalCents: 10, reservedAt: "2026-11-13T02:00:00.000Z" }),
    ];
    const view = buildPortfolio(inputs({
      range: "30d",
      entries,
      markets: new Map([[SOL, market({ eventTitle: "SOL", category: "Crypto", yesCents: 50 })], [FED, market()]]),
    }));
    expect(view.dailySpend.days.length).toBeLessThanOrEqual(14);
    expect(view.dailySpend.caption).toMatch(/Busiest day: \$8\.10 on Nov 12/);
    expect(view.dailySpend.caption).toMatch(/never hit the cap/);
    expect(view.dailyCapCents).toBe(2000);
  });
});

describe("activityCsv", () => {
  it("escapes quotes and includes the paper ticket and signature", () => {
    const view = buildPortfolio({
      entries: [entry({
        operationId: "q1",
        kind: "trade",
        symbol: SOL,
        notionalCents: 200,
        reservedAt: "2026-11-12T18:00:00.000Z",
        ticket: { ticketId: "tk,1", symbol: SOL, outcome: "yes", quantity: "4", price: "0.50", mode: "paper" },
      })],
      markets: new Map([[SOL, market({ eventTitle: "SOL, \"up\"?", category: "Crypto", yesCents: 50 })]]),
      history: new Map(),
      candles: new Map(),
      dailyCapCents: 2000,
      range: "30d",
      nowMs: NOW,
    });
    const csv = activityCsv(view.activity);
    expect(csv.split("\n")[0]).toContain("Ticket");
    expect(csv).toContain("\"SOL, \"\"up\"\"?\"");
    expect(csv).toContain("\"tk,1\"");
    expect(csv).toContain("sig-q1");
    expect(csv).toContain("cluster=devnet");
  });
});
