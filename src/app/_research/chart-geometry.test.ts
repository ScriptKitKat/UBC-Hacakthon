import { describe, expect, it } from "vitest";
import type { ResearchSeriesPoint } from "@/shared";
import { DEFAULT_BOX, buildChartGeometry, nearestIndex, valueRange } from "./chart-geometry";

function point(t: number, cents: number, overrides: Partial<ResearchSeriesPoint> = {}): ResearchSeriesPoint {
  return { t, cents, volume: null, source: "gemini", bidCents: null, askCents: null, ma: null, upper: null, lower: null, ...overrides };
}

describe("valueRange", () => {
  it("uses the full 0-100 axis unless zoomed", () => {
    expect(valueRange([point(0, 5), point(1, 6)], false)).toEqual([0, 100]);
    expect(valueRange([], true)).toEqual([0, 100]);
  });

  it("zooms to the data with padding and a minimum span", () => {
    const [low, high] = valueRange([point(0, 5), point(1, 6)], true);
    expect(low).toBeLessThanOrEqual(3);
    expect(high).toBeGreaterThanOrEqual(8);
    expect(high - low).toBeGreaterThanOrEqual(6);
  });

  it("stays inside 0..100 near the edges", () => {
    expect(valueRange([point(0, 99), point(1, 100)], true)[1]).toBeLessThanOrEqual(100);
    expect(valueRange([point(0, 0), point(1, 1)], true)[0]).toBe(0);
  });

  it("includes the band in the zoom range", () => {
    const [low, high] = valueRange([point(0, 50, { upper: 70, lower: 30 }), point(1, 51)], true);
    expect(low).toBeLessThanOrEqual(30);
    expect(high).toBeGreaterThanOrEqual(70);
  });
});

describe("buildChartGeometry", () => {
  const points = [point(0, 0, { volume: 10 }), point(1000, 100, { volume: 20 }), point(2000, 50, { volume: 0 })];

  it("maps time to x and price to y with 100% at the top of the plot", () => {
    const geometry = buildChartGeometry(points, false);
    expect(geometry.xs[0]).toBe(DEFAULT_BOX.left);
    expect(geometry.xs[2]).toBe(DEFAULT_BOX.width - DEFAULT_BOX.right);
    expect(geometry.ys[0]).toBe(geometry.plotBottom);
    expect(geometry.ys[1]).toBe(geometry.plotTop);
    expect(geometry.ys[2]).toBeCloseTo((geometry.plotTop + geometry.plotBottom) / 2, 5);
  });

  it("draws one path segment per point", () => {
    const geometry = buildChartGeometry(points, false);
    expect(geometry.line.startsWith("M")).toBe(true);
    expect(geometry.line.match(/L/gu)).toHaveLength(2);
  });

  it("scales volume bars to the tallest bar and skips empty volume", () => {
    const geometry = buildChartGeometry(points, false);
    expect(geometry.bars).toHaveLength(2);
    expect(geometry.bars[1]?.height).toBe(DEFAULT_BOX.volumeHeight);
    expect(geometry.bars[0]?.height).toBe(DEFAULT_BOX.volumeHeight / 2);
  });

  it("emits nothing for overlays until moving averages exist", () => {
    const geometry = buildChartGeometry(points, false);
    expect(geometry.average).toBe("");
    expect(geometry.band).toBe("");
  });

  it("builds a closed band polygon and average path from overlay values", () => {
    const overlaid = [point(0, 40, { ma: 40, upper: 45, lower: 35 }), point(1000, 42, { ma: 41, upper: 46, lower: 36 })];
    const geometry = buildChartGeometry(overlaid, false);
    expect(geometry.band.endsWith("Z")).toBe(true);
    expect(geometry.average.match(/L/gu)).toHaveLength(1);
  });

  it("centres a single point and has no x ticks", () => {
    const geometry = buildChartGeometry([point(5, 30)], false);
    expect(geometry.xs[0]).toBe((DEFAULT_BOX.left + DEFAULT_BOX.width - DEFAULT_BOX.right) / 2);
    expect(geometry.xTicks).toEqual([]);
  });

  it("handles an empty series", () => {
    const geometry = buildChartGeometry([], false);
    expect(geometry.line).toBe("");
    expect(geometry.bars).toEqual([]);
    expect(geometry.yTicks.map((tick) => tick.value)).toEqual([0, 25, 50, 75, 100]);
  });

  it("labels the probability axis in the full range", () => {
    expect(buildChartGeometry(points, false).yTicks.map((tick) => tick.value)).toEqual([0, 25, 50, 75, 100]);
  });

  it("places five evenly spaced time ticks", () => {
    const ticks = buildChartGeometry(points, false).xTicks;
    expect(ticks).toHaveLength(5);
    expect(ticks[0]?.t).toBe(0);
    expect(ticks[4]?.t).toBe(2000);
  });
});

describe("nearestIndex", () => {
  it("finds the closest x", () => {
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([10, 50, 90], -100)).toBe(0);
  });

  it("returns undefined for no points", () => {
    expect(nearestIndex([], 5)).toBeUndefined();
  });
});
