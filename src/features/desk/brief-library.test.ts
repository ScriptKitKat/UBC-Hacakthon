import { describe, expect, it } from "vitest";
import { instrumentSymbol } from "@/shared";
import type { MarketContract, MarketEvent } from "@/features/markets";
import type { StoredPurchase } from "./purchase-store";
import { buildBriefLibrary, toLibraryItem } from "./brief-library";

const SYMBOL = instrumentSymbol("GEMI-FED261211-MAINTAIN");
const CLOSED = instrumentSymbol("GEMI-SOL2611192100-HI73");

const classicBrief = {
  symbol: SYMBOL,
  generatedAt: "2026-11-12T18:00:00.000Z",
  headline: "Fed holds: Maintain is priced at 48¢ for YES",
  sections: [{ title: "What the market thinks", body: "Buying YES costs 48¢, which the market reads as roughly a 48% chance." }],
  polishedBy: "template" as const,
};

function purchase(overrides: Partial<StoredPurchase> = {}): StoredPurchase {
  return {
    symbol: SYMBOL,
    atMs: Date.parse("2026-11-12T18:00:00.000Z"),
    brief: classicBrief,
    receipt: { signature: "sig-desk", explorerUrl: "https://explorer.solana.com/tx/sig-desk?cluster=devnet", costCents: 5 },
    yesCents: 48,
    ...overrides,
  };
}

function contract(symbol: MarketContract["instrumentSymbol"], extras: Partial<MarketContract> = {}): MarketContract {
  return {
    instrumentSymbol: symbol,
    label: "Fed maintains rate",
    description: "",
    expiryDate: "2026-12-11T19:00:00Z",
    marketState: "open",
    status: "active",
    prices: { bestBidCents: 60, bestAskCents: 64, lastTradeCents: 62, buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38 },
    limits: null,
    ...extras,
  };
}

function event(contracts: readonly MarketContract[], extras: Partial<MarketEvent> = {}): MarketEvent {
  return {
    ticker: "FED261211",
    title: "Fed decision in December?",
    category: "Economics",
    status: "active",
    expiryDate: "2026-12-11T19:00:00Z",
    description: "",
    subcategory: null,
    volume: null,
    volume24h: null,
    tags: [],
    contracts: [...contracts],
    ...extras,
  };
}

describe("toLibraryItem", () => {
  it("defaults a missing author to the desk and keeps an old brief's classic sections", () => {
    const item = toLibraryItem(purchase(), null);
    expect(item).toMatchObject({
      author: "desk",
      category: "Market",
      yesCentsWhenWritten: 48,
      yesCentsNow: null,
      needsRefresh: false,
      resolved: null,
    });
    expect(item?.brief.sections.map((section) => section.title)).toEqual(["What the market thinks"]);
  });

  it("marks an open market stale once live odds have moved 10 or more points", () => {
    const live = {
      category: "Economics",
      eventTitle: "Fed decision in December?",
      contractLabel: "Fed maintains rate",
      eventStatus: "active",
      contractStatus: "active",
      marketState: "open",
      yesCents: 62,
    };
    expect(toLibraryItem(purchase(), live)?.needsRefresh).toBe(true);
    expect(toLibraryItem(purchase({ yesCents: 55 }), live)?.needsRefresh).toBe(false);
  });

  it("treats a settled contract as resolved and not in need of refresh", () => {
    const live = {
      category: "Crypto",
      eventTitle: "SOL above $200?",
      contractLabel: "Yes",
      eventStatus: "settled",
      contractStatus: "settled",
      marketState: "closed",
      resolutionSide: "no" as const,
      yesCents: 0,
    };
    const item = toLibraryItem(purchase({ symbol: CLOSED, yesCents: 22 }), live);
    expect(item).toMatchObject({ resolved: "no", yesCentsNow: 0, needsRefresh: false, category: "Crypto" });
  });
});

describe("buildBriefLibrary", () => {
  it("joins purchases to live marks, counts agent authors, and skips briefs that never arrived", async () => {
    const open = event([contract(SYMBOL)]);
    const settled = event(
      [contract(CLOSED, { label: "Yes", status: "settled", marketState: "closed", resolutionSide: "no", prices: { ...contract(CLOSED).prices, buyYesCents: 0, buyNoCents: 100 } })],
      { ticker: "SOL2611192100", title: "SOL above $200?", category: "Crypto", status: "settled" },
    );
    const view = await buildBriefLibrary({
      now: new Date("2026-11-19T18:00:00.000Z"),
      getEvent: (ticker) => Promise.resolve(ticker === "SOL2611192100" ? { ok: true, value: settled } : { ok: true, value: open }),
      purchases: [
        purchase(),
        purchase({
          symbol: CLOSED,
          atMs: Date.parse("2026-11-18T15:00:00.000Z"),
          receipt: { signature: "sig-agent", explorerUrl: "https://explorer.solana.com/tx/sig-agent?cluster=devnet", costCents: 5 },
          author: { agentId: "scout-1", name: "Scout", model: "Grok", personality: "Calm analyst" },
          yesCents: 22,
        }),
        purchase({
          brief: null,
          receipt: { signature: "sig-empty", explorerUrl: "https://explorer.solana.com/tx/sig-empty?cluster=devnet", costCents: 5 },
        }),
      ],
    });
    expect(view.items.map((item) => item.id)).toEqual(["sig-agent", "sig-desk"]);
    expect(view.stats).toEqual({ count: 2, spentCents: 10, writtenByAgents: 1 });
    expect(view.items[0]).toMatchObject({ id: "sig-agent", resolved: "no", needsRefresh: false, author: { name: "Scout" } });
    expect(view.items[1]).toMatchObject({ id: "sig-desk", needsRefresh: true, yesCentsNow: 62, resolved: null });
  });
});
