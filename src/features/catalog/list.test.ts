import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "@/features/history";
import { instrumentSymbol } from "@/shared";
import type { Candle, MarketEvent } from "@/features/markets";
import { listCatalog } from "./list";

function contract(label: string, symbol: string, yes: number, no: number, expiry: string) {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label,
    description: label,
    expiryDate: expiry,
    marketState: "open",
    status: "active",
    prices: {
      bestBidCents: yes - 1,
      bestAskCents: yes,
      lastTradeCents: yes,
      buyYesCents: yes,
      buyNoCents: no,
      sellYesCents: yes - 1,
      sellNoCents: no - 1,
    },
    limits: null,
  };
}

function event(ticker: string, title: string, category: string, yes: number, no: number): MarketEvent {
  return {
    ticker,
    title,
    category,
    status: "active",
    expiryDate: "2026-11-26T18:00:00.000Z",
    description: title,
    subcategory: null,
    volume: 100,
    volume24h: 10,
    tags: [],
    contracts: [contract(title, `GEMI-${ticker}-YES`, yes, no, "2026-11-26T18:00:00.000Z")],
  };
}

describe("listCatalog", () => {
  it("sorts moving markets by absolute 24h change and maps Economics to Economy", async () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const history = createMemoryHistory();
    const rising = event("BTC", "Bitcoin above 60k?", "Crypto", 50, 50);
    const falling = event("FED", "Fed holds in December?", "Economics", 40, 60);
    const quiet = event("NBA", "Lakers win?", "Sports", 55, 45);
    history.watch("GEMI-BTC-YES");
    history.watch("GEMI-FED-YES");
    history.record("GEMI-BTC-YES", { atMs: now.getTime() - 24 * 3600_000, yesCents: 40, bidCents: null, askCents: null });
    history.record("GEMI-BTC-YES", { atMs: now.getTime(), yesCents: 50, bidCents: null, askCents: null });
    history.record("GEMI-FED-YES", { atMs: now.getTime() - 24 * 3600_000, yesCents: 80, bidCents: null, askCents: null });
    history.record("GEMI-FED-YES", { atMs: now.getTime(), yesCents: 40, bidCents: null, askCents: null });
    const result = await listCatalog(
      {
        markets: {
          searchEvents: () => Promise.resolve({ ok: true, value: { events: [quiet, rising, falling], total: 3 } }),
          candles: () => Promise.resolve({ ok: false, error: { kind: "network" as const } }),
        },
        history,
        now: () => now,
      },
      { sort: "moving", limit: 6 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.markets.map((market) => market.eventTicker)).toEqual(["FED", "BTC", "NBA"]);
    expect(result.page.markets[0]?.categoryLabel).toBe("Economy");
    expect(result.page.markets[0]?.changePercent).toBe(-50);
    expect(result.page.markets[1]?.changePercent).toBe(25);
    expect(result.page.markets[0]?.endsIn).toBe("ends in 7d");
    expect(result.page.categories).toEqual(["Crypto", "Economy", "Sports"]);
  });

  it("fills a sparkline from hourly candles when history is short", async () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const history = createMemoryHistory();
    const fed = event("FED", "Fed holds?", "Economics", 44, 56);
    const candles: Candle[] = [16, 12, 8, 0].map((hoursAgo, index) => ({
      timeMs: now.getTime() - hoursAgo * 3600_000,
      openCents: 40 + index,
      highCents: 42 + index,
      lowCents: 38 + index,
      closeCents: 40 + index * 2,
      volume: 1,
    }));
    const candlesFn = vi.fn(() => Promise.resolve({ ok: true as const, value: candles }));
    const result = await listCatalog(
      {
        markets: {
          searchEvents: () => Promise.resolve({ ok: true, value: { events: [fed], total: 1 } }),
          candles: candlesFn,
        },
        history,
        now: () => now,
      },
      { sort: "moving" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(candlesFn).toHaveBeenCalledWith("GEMI-FED-YES", "1hr");
    expect(result.page.markets[0]?.sparkline.length).toBeGreaterThan(1);
    expect(result.page.markets[0]?.changePercent).not.toBeNull();
  });

  it("reports unavailability when Gemini search fails", async () => {
    const result = await listCatalog({
      markets: {
        searchEvents: () => Promise.resolve({ ok: false, error: { kind: "network" } }),
        candles: vi.fn(),
      },
      history: createMemoryHistory(),
      now: () => new Date("2026-11-19T18:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});
