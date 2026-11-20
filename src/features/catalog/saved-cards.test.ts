import { describe, expect, it } from "vitest";
import { createMemoryHistory } from "@/features/history";
import { instrumentSymbol } from "@/shared";
import type { MarketEvent } from "@/features/markets";
import { cardsForSaved, marketLifecycle, researchHref } from "./saved-cards";

function contract(label: string, symbol: string, yes: number, expiry: string, state = "open", status = "active") {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label,
    description: label,
    expiryDate: expiry,
    marketState: state,
    status,
    prices: {
      bestBidCents: yes - 1,
      bestAskCents: yes,
      lastTradeCents: yes,
      buyYesCents: yes,
      buyNoCents: 100 - yes,
      sellYesCents: yes - 1,
      sellNoCents: 99 - yes,
    },
    limits: null,
  };
}

function event(overrides: Partial<MarketEvent> & Pick<MarketEvent, "ticker" | "title">): MarketEvent {
  return {
    category: "Crypto",
    status: "active",
    expiryDate: "2026-12-31T22:00:00.000Z",
    description: overrides.title,
    subcategory: null,
    volume: 100,
    volume24h: 10,
    tags: [],
    contracts: [contract("Yes", `GEMI-${overrides.ticker}-YES`, 62, "2026-12-31T22:00:00.000Z")],
    ...overrides,
  };
}

describe("saved market cards", () => {
  it("loads live Gemini data for saved items and keeps the stored yes percent", async () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const history = createMemoryHistory();
    history.watch("GEMI-SOL261231-YES");
    history.record("GEMI-SOL261231-YES", { atMs: now.getTime() - 24 * 3600_000, yesCents: 53, bidCents: null, askCents: null });
    history.record("GEMI-SOL261231-YES", { atMs: now.getTime(), yesCents: 62, bidCents: null, askCents: null });
    const listed = event({ ticker: "SOL261231", title: "SOL above $200 by Dec 31?" });
    const cards = await cardsForSaved(
      {
        markets: {
          searchEvents: () => Promise.resolve({ ok: true, value: { events: [listed], total: 1 } }),
          getEvent: (ticker) => ticker === "SOL261231"
            ? Promise.resolve({ ok: true, value: listed })
            : Promise.resolve({ ok: false, error: { kind: "http", status: 404 } }),
          candles: () => Promise.resolve({ ok: false, error: { kind: "network" as const } }),
        },
        history,
        now: () => now,
      },
      [{ eventTicker: "SOL261231", instrumentSymbol: "GEMI-SOL261231-YES", savedAt: "2026-11-01T00:00:00.000Z", savedYesCents: 48 }],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.eventTitle).toBe("SOL above $200 by Dec 31?");
    expect(cards[0]?.yesCents).toBe(62);
    expect(cards[0]?.savedYesCents).toBe(48);
    expect(cards[0]?.todayPoints).toBe(9);
    expect(cards[0]?.status).toBe("live");
    expect(cards[0]?.href).toBe("/markets/GEMI-SOL261231-YES?contract=GEMI-SOL261231-YES");
  });

  it("marks settled and expired markets without dropping them from the list", async () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const settled = event({
      ticker: "FED261110",
      title: "Fed cut rates in November?",
      status: "settled",
      expiryDate: "2026-11-10T18:00:00.000Z",
      contracts: [contract("Yes", "GEMI-FED261110-YES", 100, "2026-11-10T18:00:00.000Z", "closed", "settled")],
    });
    const ended = event({
      ticker: "WXHIGH-NYC",
      title: "Snow in New York City before Nov 18?",
      category: "Weather",
      expiryDate: "2026-11-18T18:00:00.000Z",
      contracts: [contract("Yes", "GEMI-WXHIGH-NYC-YES", 18, "2026-11-18T18:00:00.000Z", "closed", "inactive")],
    });
    const cards = await cardsForSaved(
      {
        markets: {
          searchEvents: () => Promise.resolve({ ok: true, value: { events: [], total: 0 } }),
          getEvent: (ticker) => {
            const value = ticker === "FED261110" ? settled : ticker === "WXHIGH-NYC" ? ended : undefined;
            return value === undefined
              ? Promise.resolve({ ok: false, error: { kind: "http" as const, status: 404 } })
              : Promise.resolve({ ok: true, value });
          },
          candles: () => Promise.resolve({ ok: false, error: { kind: "network" as const } }),
        },
        history: createMemoryHistory(),
        now: () => now,
      },
      [
        { eventTicker: "FED261110", instrumentSymbol: "GEMI-FED261110-YES", savedAt: "2026-11-01T00:00:00.000Z", savedYesCents: 40 },
        { eventTicker: "WXHIGH-NYC", instrumentSymbol: "GEMI-WXHIGH-NYC-YES", savedAt: "2026-11-01T00:00:00.000Z", savedYesCents: 20 },
        { eventTicker: "GONE", instrumentSymbol: null, savedAt: "2026-11-01T00:00:00.000Z", savedYesCents: 33 },
      ],
    );
    expect(cards.map((card) => card.status)).toEqual(["settled", "ended", "ended"]);
    expect(cards[2]?.eventTicker).toBe("GONE");
    expect(cards[2]?.yesCents).toBe(33);
  });

  it("labels settled vs ended from market state and expiry", () => {
    const now = new Date("2026-11-19T18:00:00.000Z");
    const open = { status: "active", expiryDate: "2026-12-31T00:00:00.000Z", marketState: "open" };
    expect(marketLifecycle(open, open, now)).toBe("live");
    expect(marketLifecycle({ status: "settled", expiryDate: "2026-12-31T00:00:00.000Z" }, { status: "settled", marketState: "closed", expiryDate: "2026-12-31T00:00:00.000Z" }, now)).toBe("settled");
    expect(marketLifecycle({ status: "active", expiryDate: "2026-11-18T00:00:00.000Z" }, { status: "active", marketState: "open", expiryDate: "2026-11-18T00:00:00.000Z" }, now)).toBe("ended");
    expect(researchHref("GEMI-FED-YES")).toBe("/markets/GEMI-FED-YES?contract=GEMI-FED-YES");
  });
});
