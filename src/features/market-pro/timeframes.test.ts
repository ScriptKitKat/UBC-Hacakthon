import { describe, expect, it } from "vitest";
import type { Candle } from "@/features/markets";
import { aggregateCandles, cropToTradedWindow, defaultProTimeframe, isTradedCandle, pickReadableTimeframe, planCandles, planChartCandles, tradedCount } from "./timeframes";

function candle(timeMs: number, open: number, high: number, low: number, close: number, volume = 1): Candle {
  return { timeMs, openCents: open, highCents: high, lowCents: low, closeCents: close, volume };
}

describe("aggregateCandles", () => {
  it("groups hourly candles into 4-hour buckets and preserves OHLC and volume", () => {
    const hour = 60 * 60 * 1000;
    const start = Date.UTC(2026, 10, 19, 0, 0, 0);
    const candles = [
      candle(start, 50, 52, 49, 51, 10),
      candle(start + hour, 51, 55, 50, 54, 20),
      candle(start + 2 * hour, 54, 56, 53, 53, 5),
      candle(start + 4 * hour, 53, 60, 53, 59, 8),
    ];
    const buckets = aggregateCandles(candles, 4 * hour);
    expect(buckets).toEqual([
      { timeMs: start, openCents: 50, highCents: 56, lowCents: 49, closeCents: 53, volume: 35 },
      { timeMs: start + 4 * hour, openCents: 53, highCents: 60, lowCents: 53, closeCents: 59, volume: 8 },
    ]);
  });

  it("groups daily candles that fall in the same 7-day bucket and splits the next week", () => {
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;
    const start = Date.UTC(2026, 10, 16, 0, 0, 0);
    const candles = [
      candle(start, 10, 12, 9, 11, 1),
      candle(start + 2 * day, 11, 14, 10, 13, 2),
      candle(start + week, 13, 15, 12, 14, 3),
    ];
    const buckets = aggregateCandles(candles, week);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ openCents: 10, highCents: 14, lowCents: 9, closeCents: 13, volume: 3 });
    expect(buckets[1]).toMatchObject({ closeCents: 14, volume: 3 });
    expect(buckets[1]?.timeMs ?? 0).toBe((buckets[0]?.timeMs ?? 0) + week);
  });
});

describe("planCandles", () => {
  it("windows 5m candles to the last 12 hours", () => {
    const now = Date.UTC(2026, 10, 19, 18, 0, 0);
    const five = 5 * 60 * 1000;
    const inside = candle(now - 11 * 60 * 60 * 1000, 40, 41, 39, 40);
    const outside = candle(now - 13 * 60 * 60 * 1000, 30, 31, 29, 30);
    const latest = candle(now - five, 42, 43, 41, 42);
    expect(planCandles([outside, inside, latest], "5m", now).map((item) => item.timeMs)).toEqual([inside.timeMs, latest.timeMs]);
  });
});

describe("defaultProTimeframe", () => {
  const now = Date.UTC(2026, 10, 19, 18);

  it("picks 5m when the contract expires within 8 hours", () => {
    expect(defaultProTimeframe(new Date(now + 90 * 60 * 1000).toISOString(), now)).toBe("5m");
  });

  it("picks 1h when the contract expires within two days", () => {
    expect(defaultProTimeframe(new Date(now + 30 * 60 * 60 * 1000).toISOString(), now)).toBe("1h");
  });

  it("picks 1D for longer-dated contracts or missing expiry", () => {
    expect(defaultProTimeframe(new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe("1D");
    expect(defaultProTimeframe(null, now)).toBe("1D");
  });
});

describe("cropToTradedWindow and planChartCandles", () => {
  const five = 5 * 60 * 1000;
  const now = Date.UTC(2026, 10, 19, 20);

  function bar(timeMs: number, close: number, volume: number, high = close, low = close): Candle {
    return candle(timeMs, close, high, low, close, volume);
  }

  it("drops leading and trailing zero-volume flats and keeps the gap between trades", () => {
    const series = [
      bar(now - 10 * five, 40, 0),
      bar(now - 9 * five, 40, 0),
      bar(now - 8 * five, 40, 10, 42, 39),
      bar(now - 7 * five, 41, 0),
      bar(now - 6 * five, 44, 12, 45, 41),
      bar(now - 5 * five, 44, 0),
      bar(now - 4 * five, 44, 0),
    ];
    const cropped = cropToTradedWindow(series);
    expect(cropped.map((item) => item.timeMs)).toEqual([
      now - 8 * five,
      now - 7 * five,
      now - 6 * five,
    ]);
    const held = cropped[1];
    expect(held).toBeDefined();
    if (held === undefined) return;
    expect(isTradedCandle(held)).toBe(false);
    expect(tradedCount(cropped)).toBe(2);
  });

  it("returns no candles when the series is only flat fills", () => {
    const flats = Array.from({ length: 40 }, (_, index) => bar(now - (40 - index) * five, 89, 0));
    expect(cropToTradedWindow(flats)).toEqual([]);
    expect(planChartCandles(flats, "5m", now)).toEqual([]);
  });

  it("uses the full traded range when a 5m series is too sparse to fill the usual window", () => {
    const tradedEarly = bar(now - 16 * 60 * 60 * 1000, 72, 9.5);
    const tradedLate = bar(now - 14 * 60 * 60 * 1000, 89, 105, 91, 89);
    const trailing = Array.from({ length: 20 }, (_, index) => bar(now - (20 - index) * five, 89, 0));
    const planned = planChartCandles([tradedEarly, tradedLate, ...trailing], "5m", now);
    expect(planned[0]?.timeMs).toBe(tradedEarly.timeMs);
    expect(planned.at(-1)?.timeMs).toBe(tradedLate.timeMs);
    expect(tradedCount(planned)).toBe(2);
  });

  it("picks the finest timeframe that has at least 20 traded candles", () => {
    expect(pickReadableTimeframe({ "5m": 4, "1h": 8, "4h": 8, "1D": 2 }, "5m")).toBe("5m");
    expect(pickReadableTimeframe({ "5m": 4, "1h": 22, "4h": 30 }, "5m")).toBe("1h");
    expect(pickReadableTimeframe({ "5m": 24, "1h": 30 }, "1D")).toBe("5m");
  });
});
