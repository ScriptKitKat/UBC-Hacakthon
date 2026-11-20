import { describe, expect, it } from "vitest";
import { eventsPageSchema } from "./schema";

describe("eventsPageSchema", () => {
  it("accepts a reference strike that has not published a value yet", () => {
    const parsed = eventsPageSchema.safeParse({
      data: [
        {
          ticker: "BTC05M2611191745",
          title: "BTC price today at 12:45pm EST",
          category: "Crypto",
          status: "active",
          expiryDate: "2026-11-19T17:45:00.000Z",
          isLive: true,
          contracts: [
            {
              instrumentSymbol: "GEMI-BTC05M2611191745-UP",
              label: "Up",
              marketState: "open",
              status: "active",
              prices: { buy: { yes: "0.40", no: "0.62" }, sell: { yes: "0.38", no: "0.60" }, bestBid: "0.38", bestAsk: "0.40" },
              strike: { type: "reference", availableAt: "2026-11-19T17:40:00.000Z" },
            },
          ],
        },
      ],
      pagination: { total: 1 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.events[0]?.contracts[0]?.strikeValue ?? null).toBeNull();
  });
});

import { candlesSchema } from "./schema";

describe("candlesSchema", () => {
  it("returns candles oldest-first when Gemini sends newest-first rows", () => {
    const parsed = candlesSchema.parse([
      [1_800_000, 0.6, 0.61, 0.59, 0.6, 10],
      [1_200_000, 0.5, 0.51, 0.49, 0.5, 8],
      [600_000, 0.4, 0.41, 0.39, 0.4, 4],
    ]);
    expect(parsed.map((candle) => candle.timeMs)).toEqual([600_000, 1_200_000, 1_800_000]);
    expect(parsed.map((candle) => candle.closeCents)).toEqual([40, 50, 60]);
  });
});
