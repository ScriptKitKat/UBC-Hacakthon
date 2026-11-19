import { describe, expect, it } from "vitest";
import { createMemoryHistory } from "@/features/history";
import type { MarketEvent, SearchEventsQuery } from "@/features/markets";
import { instrumentSymbol } from "@/shared";
import { listBrowse, loadSpotPrices } from "./browse";

function contract(label: string, symbol: string, yes: number, extras: Partial<MarketEvent["contracts"][number]> = {}) {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label,
    description: label,
    expiryDate: "2026-11-19T22:00:00.000Z",
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
    ...extras,
  };
}

function event(partial: Partial<MarketEvent> & Pick<MarketEvent, "ticker" | "title" | "category" | "contracts">): MarketEvent {
  return {
    status: "active",
    expiryDate: "2026-11-19T22:00:00.000Z",
    description: partial.title,
    subcategory: null,
    volume: 100,
    volume24h: 100,
    tags: [],
    isLive: false,
    createdAt: "2026-11-18T00:00:00.000Z",
    startTime: null,
    ...partial,
  };
}

describe("listBrowse", () => {
  it("builds sports and crypto cards with ask-based payouts and sorts by volume", async () => {
    const sports = event({
      ticker: "NCAAM-TAMU-TCU",
      title: "Texas A&M vs TCU",
      category: "Sports",
      subcategory: "College Basketball",
      volume: 7100,
      volume24h: 7100,
      contracts: [
        contract("Texas A&M", "GEMI-NCAAM-TAMU", 51, { abbreviatedName: "TAMU", color: "#500000" }),
        contract("TCU", "GEMI-NCAAM-TCU", 50, { abbreviatedName: "TCU", color: "#4B2E83" }),
      ],
    });
    const bitcoin = event({
      ticker: "BTC2611192200",
      title: "BTC price on November 19",
      category: "Crypto",
      volume: 37_800,
      volume24h: 37_800,
      isLive: true,
      contracts: [
        contract("$61,000 or above", "GEMI-BTC2611192200-HI61000", 80, { strikeValue: 61000 }),
        contract("$62,800 or above", "GEMI-BTC2611192200-HI62800", 48, { strikeValue: 62800 }),
        contract("$63,000 or above", "GEMI-BTC2611192200-HI63000", 40, { strikeValue: 63000 }),
        contract("$64,000 or above", "GEMI-BTC2611192200-HI64000", 12, { strikeValue: 64000 }),
      ],
    });
    const hold = event({
      ticker: "FED261211",
      title: "Fed decision in December?",
      category: "Economics",
      volume: 400,
      volume24h: 400,
      createdAt: "2026-11-19T12:00:00.000Z",
      expiryDate: "2026-12-10T18:00:00.000Z",
      contracts: [
        contract("Yes", "GEMI-FED261211-YES", 71),
        contract("No", "GEMI-FED261211-NO", 30),
      ],
    });
    const result = await listBrowse(
      {
        markets: {
          searchEvents: () => Promise.resolve({ ok: true, value: { events: [sports, bitcoin, hold], total: 3 } }),
          candles: () => Promise.resolve({ ok: true, value: [] }),
          pubticker: (pair) => Promise.resolve(pair === "btcusd" ? { ok: true, value: { last: 62827 } } : { ok: false, error: { kind: "http", status: 404 } }),
        },
        history: createMemoryHistory(),
        now: () => new Date("2026-11-19T16:00:00.000Z"),
      },
      { sort: "trending", limit: 24 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.markets.map((card) => card.eventTicker)).toEqual(["BTC2611192200", "NCAAM-TAMU-TCU", "FED261211"]);
    const crypto = result.page.markets[0];
    expect(crypto?.kind).toBe("crypto");
    expect(crypto?.displayTitle).toBe("Bitcoin price today?");
    expect(crypto?.isLive).toBe(true);
    expect(crypto?.spotLabel).toBeNull();
    expect(crypto?.rows.map((row) => row.label)).toEqual(["$62,800 or above", "$63,000 or above"]);
    expect(crypto?.rows[0]?.payoutBeginner).toBe("$1 → $2.08");
    expect(crypto?.rows[0]?.href).toBe("/markets/GEMI-BTC2611192200-HI62800");
    expect(crypto?.moreCount).toBe(2);
    const game = result.page.markets[1];
    expect(game?.kind).toBe("sports");
    expect(game?.categoryLabel).toBe("College Basketball");
    expect(game?.rows.map((row) => row.short)).toEqual(["TAMU", "TCU"]);
    const binary = result.page.markets[2];
    expect(binary?.kind).toBe("binary");
    expect(binary?.rows.map((row) => row.label)).toEqual(["Yes", "No"]);
  });

  it("sorts closing soon by expiry and newest by createdAt", async () => {
    const early = event({
      ticker: "A",
      title: "Early",
      category: "Politics",
      expiryDate: "2026-11-20T00:00:00.000Z",
      createdAt: "2026-11-01T00:00:00.000Z",
      contracts: [contract("Yes", "GEMI-A-YES", 40), contract("No", "GEMI-A-NO", 60)],
    });
    const late = event({
      ticker: "B",
      title: "Late",
      category: "Politics",
      expiryDate: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-11-18T00:00:00.000Z",
      contracts: [contract("Yes", "GEMI-B-YES", 40), contract("No", "GEMI-B-NO", 60)],
    });
    const deps = {
      markets: {
        searchEvents: () => Promise.resolve({ ok: true as const, value: { events: [late, early], total: 2 } }),
        candles: () => Promise.resolve({ ok: true as const, value: [] }),
        pubticker: () => Promise.resolve({ ok: false as const, error: { kind: "http" as const, status: 404 } }),
      },
      history: createMemoryHistory(),
      now: () => new Date("2026-11-19T16:00:00.000Z"),
    };
    const closing = await listBrowse(deps, { sort: "closing" });
    const newest = await listBrowse(deps, { sort: "newest" });
    expect(closing.ok && closing.page.markets.map((card) => card.eventTicker)).toEqual(["A", "B"]);
    expect(newest.ok && newest.page.markets.map((card) => card.eventTicker)).toEqual(["B", "A"]);
  });

  it("pages through a sorted window and stops at a short Gemini page", async () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      event({
        ticker: `POL${String(index).padStart(2, "0")}`,
        title: `Question ${String(index)}`,
        category: "Politics",
        volume: 30 - index,
        volume24h: 30 - index,
        contracts: [contract("Yes", `GEMI-POL${String(index)}-YES`, 50), contract("No", `GEMI-POL${String(index)}-NO`, 50)],
      }),
    );
    const deps = {
      markets: {
        searchEvents: (query: SearchEventsQuery = {}) => {
          const offset = query.offset ?? 0;
          const limit = query.limit ?? 24;
          const slice = events.slice(offset, offset + limit);
          return Promise.resolve({ ok: true as const, value: { events: slice, total: events.length } });
        },
        candles: () => Promise.resolve({ ok: true as const, value: [] }),
        pubticker: () => Promise.resolve({ ok: false as const, error: { kind: "http" as const, status: 404 } }),
      },
      history: createMemoryHistory(),
      now: () => new Date("2026-11-19T16:00:00.000Z"),
    };
    const first = await listBrowse(deps, { sort: "trending", offset: 0, limit: 24 });
    const second = await listBrowse(deps, { sort: "trending", offset: 24, limit: 24 });
    expect(first.ok && first.page.hasMore).toBe(true);
    expect(first.ok && first.page.markets.map((card) => card.eventTicker)).toEqual(events.slice(0, 24).map((item) => item.ticker));
    expect(second.ok && second.page.hasMore).toBe(false);
    expect(second.ok && second.page.markets.map((card) => card.eventTicker)).toEqual(events.slice(24).map((item) => item.ticker));
  });

  it("reports unavailability when Gemini search fails", async () => {
    const result = await listBrowse({
      markets: {
        searchEvents: () => Promise.resolve({ ok: false, error: { kind: "network" } }),
        candles: () => Promise.resolve({ ok: true, value: [] }),
        pubticker: () => Promise.resolve({ ok: false, error: { kind: "network" } }),
      },
      history: createMemoryHistory(),
      now: () => new Date("2026-11-19T16:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("listBrowse latency shape", () => {
  it("fetches only one Gemini page for the first trending screen", async () => {
    let calls = 0;
    const events = Array.from({ length: 24 }, (_, index) =>
      event({
        ticker: `POL${String(index).padStart(2, "0")}`,
        title: `Question ${String(index)}`,
        category: "Politics",
        volume: 24 - index,
        volume24h: 24 - index,
        contracts: [contract("Yes", `GEMI-POL${String(index)}-YES`, 50), contract("No", `GEMI-POL${String(index)}-NO`, 50)],
      }),
    );
    const result = await listBrowse(
      {
        markets: {
          searchEvents: (query: SearchEventsQuery = {}) => {
            calls += 1;
            const offset = query.offset ?? 0;
            const limit = query.limit ?? 24;
            return Promise.resolve({ ok: true as const, value: { events: events.slice(offset, offset + limit), total: 200 } });
          },
          candles: () => Promise.resolve({ ok: true as const, value: [] }),
          pubticker: () => Promise.resolve({ ok: false as const, error: { kind: "http" as const, status: 404 } }),
        },
        history: createMemoryHistory(),
        now: () => new Date("2026-11-19T16:00:00.000Z"),
      },
      { sort: "trending", offset: 0, limit: 24 },
    );
    expect(calls).toBe(1);
    expect(result.ok && result.page.markets).toHaveLength(24);
    expect(result.ok && result.page.hasMore).toBe(true);
  });

  it("loads crypto spot tickers concurrently after the card list", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const spots = await loadSpotPrices(
      {
        markets: {
          pubticker: async () => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 20));
            inFlight -= 1;
            return { ok: true as const, value: { last: 100 } };
          },
        },
      },
      ["BTC", "ETH", "SOL", "XRP"],
    );
    expect(maxInFlight).toBeGreaterThan(1);
    expect(spots.BTC).toBe("$100.00");
  });
});
