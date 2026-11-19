import { describe, expect, it } from "vitest";
import type { Candle } from "@/features/markets";
import type { PriceSnapshot } from "@/features/history";
import { cumulativeDepth, hourlyIndicatorPoints, mergeSeries, TIMEFRAME_PLANS } from "./series";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const candle = (timeMs: number, closeCents: number, volume = 1): Candle => ({ timeMs, openCents: closeCents, highCents: closeCents, lowCents: closeCents, closeCents, volume });
const snap = (atMs: number, yesCents: number, bidCents: number | null = null, askCents: number | null = null): PriceSnapshot => ({ atMs, yesCents, bidCents, askCents });

describe("mergeSeries", () => {
  it("orders newest-first candles ascending and labels them gemini", () => {
    const result = mergeSeries({ candles: [candle(NOW - HOUR, 6), candle(NOW - 2 * HOUR, 5)], snapshots: [], windowMs: null, nowMs: NOW });
    expect(result.source).toBe("gemini");
    expect(result.points.map((point) => point.cents)).toEqual([5, 6]);
    expect(result.points.every((point) => point.source === "gemini" && point.bidCents === null)).toBe(true);
  });

  it("falls back entirely to snapshots when there are no candles", () => {
    const result = mergeSeries({ candles: [], snapshots: [snap(NOW - 2000, 60, 58, 60), snap(NOW - 1000, 61, 59, 61)], windowMs: HOUR, nowMs: NOW });
    expect(result.source).toBe("snapshot");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ source: "snapshot", bidCents: 58, askCents: 60, volume: null });
  });

  it("adds snapshots after the latest candle start for finer resolution", () => {
    const result = mergeSeries({
      candles: [candle(NOW - 3 * HOUR, 50), candle(NOW - HOUR, 52)],
      snapshots: [snap(NOW - 2 * HOUR, 51), snap(NOW - 30 * 60_000, 53, 52, 54), snap(NOW - 10 * 60_000, 54, 53, 55)],
      windowMs: null,
      nowMs: NOW,
    });
    expect(result.source).toBe("mixed");
    expect(result.points.map((point) => [point.source, point.cents])).toEqual([
      ["gemini", 50],
      ["gemini", 52],
      ["snapshot", 53],
      ["snapshot", 54],
    ]);
  });

  it("drops points outside the window and snapshots from the future", () => {
    const result = mergeSeries({
      candles: [candle(NOW - 2 * HOUR, 40), candle(NOW - 10 * 60_000, 45)],
      snapshots: [snap(NOW + 1000, 99)],
      windowMs: HOUR,
      nowMs: NOW,
    });
    expect(result.points.map((point) => point.cents)).toEqual([45]);
  });

  it("returns an empty series with source none", () => {
    expect(mergeSeries({ candles: [], snapshots: [], windowMs: null, nowMs: NOW })).toEqual({ source: "none", points: [] });
  });

  it("attaches moving average and band overlays once there are enough points", () => {
    const candles = Array.from({ length: 8 }, (_, index) => candle(NOW - (8 - index) * HOUR, 40 + index));
    const result = mergeSeries({ candles, snapshots: [], windowMs: null, nowMs: NOW });
    expect(result.points[3]?.ma).toBeNull();
    expect(result.points[4]?.ma).toBe(42);
    expect(result.points[7]?.upper).toBeGreaterThan(result.points[7]?.ma ?? 100);
  });

  it("maps every timeframe to a candle size", () => {
    expect(TIMEFRAME_PLANS["1H"].candle).toBe("1m");
    expect(TIMEFRAME_PLANS["1D"].candle).toBe("15m");
    expect(TIMEFRAME_PLANS["1W"].candle).toBe("1hr");
    expect(TIMEFRAME_PLANS.All).toEqual({ candle: "1day", windowMs: null });
  });
});

describe("hourlyIndicatorPoints", () => {
  it("uses candles when available", () => {
    expect(hourlyIndicatorPoints([candle(NOW, 7, 3), candle(NOW - HOUR, 6, 2)], [snap(NOW, 99)])).toEqual([
      { t: NOW - HOUR, cents: 6, volume: 2 },
      { t: NOW, cents: 7, volume: 3 },
    ]);
  });

  it("buckets snapshots by hour keeping the latest when there are no candles", () => {
    const hour = Math.floor(NOW / HOUR) * HOUR;
    const points = hourlyIndicatorPoints([], [snap(hour + 1000, 50), snap(hour + 2000, 52), snap(hour + HOUR + 5, 55)]);
    expect(points).toEqual([
      { t: hour, cents: 52, volume: null },
      { t: hour + HOUR, cents: 55, volume: null },
    ]);
  });
});

describe("cumulativeDepth", () => {
  it("accumulates bids from the best price down", () => {
    expect(cumulativeDepth([{ priceCents: 3, amount: 10 }, { priceCents: 5, amount: 4 }, { priceCents: 4, amount: 6 }], "bids")).toEqual([
      { priceCents: 5, amount: 4, cumulative: 4 },
      { priceCents: 4, amount: 6, cumulative: 10 },
      { priceCents: 3, amount: 10, cumulative: 20 },
    ]);
  });

  it("accumulates asks from the best price up and rounds", () => {
    const asks = cumulativeDepth([{ priceCents: 9, amount: 0.1 }, { priceCents: 6, amount: 0.2 }], "asks");
    expect(asks.map((level) => level.priceCents)).toEqual([6, 9]);
    expect(asks[1]?.cumulative).toBe(0.3);
  });

  it("handles an empty side and caps the depth", () => {
    expect(cumulativeDepth([], "bids")).toEqual([]);
    const many = Array.from({ length: 40 }, (_, index) => ({ priceCents: index + 1, amount: 1 }));
    expect(cumulativeDepth(many, "asks")).toHaveLength(15);
  });
});

describe("TIMEFRAME_PLANS", () => {
  it("maps 1M to 6-hour candles over 30 days", () => {
    expect(TIMEFRAME_PLANS["1M"]).toEqual({ candle: "6hr", windowMs: 30 * 24 * 60 * 60 * 1000 });
  });
});
