import { describe, expect, it } from "vitest";
import type { Candle } from "@/features/markets";
import { bollingerAt, chartBands, indicatorRows, onBalanceVolume, percentB, rsiSeries, smaAt } from "./indicators";

describe("smaAt", () => {
  it("returns the average of a full window and null before that", () => {
    expect(smaAt([1, 2, 3, 4], 2, 3)).toBe(2);
    expect(smaAt([1, 2, 3, 4], 1, 3)).toBeNull();
  });
});

describe("bollingerAt and percentB", () => {
  it("places bands two standard deviations from the 20-period average", () => {
    const values = Array.from({ length: 20 }, (_, index) => (index === 19 ? 30 : 10));
    const bands = bollingerAt(values, 19, 20, 2);
    expect(bands.middle).toBeCloseTo(11);
    expect(bands.upper).toBeGreaterThan(11);
    expect(bands.lower).toBeLessThan(11);
    expect(percentB(30, bands.lower ?? 0, bands.upper ?? 1)).toBeGreaterThan(0.8);
  });
});

describe("rsiSeries", () => {
  it("is 100 after a 14-period run of only gains and around 50 on a flat series after noise", () => {
    const up = Array.from({ length: 20 }, (_, index) => 10 + index);
    const rsi = rsiSeries(up);
    expect(rsi[14]).toBe(100);
    expect(rsi[19]).toBe(100);
    expect(rsi[0]).toBeNull();
    expect(rsi[13]).toBeNull();
  });
});

describe("onBalanceVolume and indicatorRows", () => {
  it("adds volume on up closes and subtracts it on down closes", () => {
    const candles: Candle[] = [
      { timeMs: 0, openCents: 10, highCents: 10, lowCents: 10, closeCents: 10, volume: 5 },
      { timeMs: 1, openCents: 10, highCents: 12, lowCents: 10, closeCents: 12, volume: 8 },
      { timeMs: 2, openCents: 12, highCents: 12, lowCents: 9, closeCents: 9, volume: 3 },
    ];
    expect(onBalanceVolume(candles)).toEqual([0, 8, 5]);
  });

  it("marks RSI as stretched above 70 and leaves depth missing when the book is empty", () => {
    const now = 20 * 60 * 60 * 1000;
    const hourly: Candle[] = Array.from({ length: 20 }, (_, index) => ({
      timeMs: index * 60 * 60 * 1000,
      openCents: 40 + index,
      highCents: 41 + index,
      lowCents: 39 + index,
      closeCents: 40 + index,
      volume: 10,
    }));
    const rows = indicatorRows({ hourly, nowMs: now, lastCents: 59, depthPlusMinus5: null });
    const rsi = rows.find((row) => row.key === "rsi");
    const depth = rows.find((row) => row.key === "depth");
    expect(rsi?.signal).toBe("Stretched");
    expect(rsi?.tone).toBe("warn");
    expect(depth?.value).toBeNull();
    expect(depth?.missing).toMatch(/order book/i);
  });
});

describe("chartBands", () => {
  it("aligns one band point to each candle", () => {
    const candles: Candle[] = Array.from({ length: 5 }, (_, index) => ({
      timeMs: index,
      openCents: 50,
      highCents: 51,
      lowCents: 49,
      closeCents: 50 + index,
      volume: 1,
    }));
    const bands = chartBands(candles);
    expect(bands).toHaveLength(5);
    expect(bands[4]?.ma7).toBeNull();
    expect(bands[4]?.timeMs).toBe(4);
  });
});
