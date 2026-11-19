import { describe, expect, it } from "vitest";
import { bandsAt, computeIndicators, rollingBands } from "./indicators";
import type { IndicatorPoint } from "./indicators";

const HOUR = 3_600_000;
const START = 1_700_000_000_000;

function hourly(prices: readonly number[], volumes: readonly (number | null)[] = []): IndicatorPoint[] {
  return prices.map((cents, index) => ({ t: START + index * HOUR, cents, volume: index < volumes.length ? (volumes[index] ?? null) : 0 }));
}

function indicatorsFor(prices: readonly number[], volumes: readonly (number | null)[] = []) {
  return computeIndicators(hourly(prices, volumes));
}

const flat = (value: number, count: number) => Array.from({ length: count }, () => value);
const ramp = (from: number, step: number, count: number) => Array.from({ length: count }, (_, index) => from + step * index);

describe("empty and short series", () => {
  it("never invents values for an empty series", () => {
    const result = computeIndicators([]);
    expect(result.momentum).toMatchObject({ value: null, zone: null });
    expect(result.jumpiness).toMatchObject({ value: null, mean: null, outsideBand: false });
    expect(result.volumeSpike).toMatchObject({ ratio: null, obvTrend: null });
    expect(result.averagePrice).toMatchObject({ value: null });
    expect(result.recentMove).toMatchObject({ hourCents: null, dayCents: null });
    for (const reading of [result.momentum.reading, result.jumpiness.reading, result.volumeSpike.reading, result.averagePrice.reading, result.recentMove.reading]) {
      expect(reading).toContain("Not enough trading yet");
    }
  });

  it("handles a single point", () => {
    const result = indicatorsFor([40]);
    expect(result.averagePrice.value).toBeNull();
    expect(result.recentMove.hourCents).toBeNull();
    expect(result.jumpiness.value).toBeNull();
  });

  it("needs five points before averaging", () => {
    expect(indicatorsFor([40, 41, 42, 43]).averagePrice.value).toBeNull();
    expect(indicatorsFor([40, 41, 42, 43, 44]).averagePrice.value).toBe(42);
  });

  it("needs fifteen points before momentum", () => {
    expect(indicatorsFor(ramp(10, 1, 14)).momentum.value).toBeNull();
    expect(indicatorsFor(ramp(10, 1, 15)).momentum.value).not.toBeNull();
  });
});

describe("averagePrice", () => {
  it("averages the last 20 points", () => {
    const prices = [...flat(10, 10), ...flat(30, 20)];
    const result = indicatorsFor(prices).averagePrice;
    expect(result.value).toBe(30);
    expect(result.window).toBe(20);
  });

  it("describes a price above its average", () => {
    const result = indicatorsFor([40, 40, 40, 40, 40, 40, 40, 40, 40, 50]).averagePrice;
    expect(result.reading).toBe("The average price over the last 10 hours is 41¢. The price now (50¢) is 9¢ above it.");
  });

  it("describes a price below its average", () => {
    const result = indicatorsFor([60, 60, 60, 60, 60, 60, 60, 60, 60, 50]).averagePrice;
    expect(result.reading).toContain("below it");
  });

  it("calls a price near its average steady", () => {
    expect(indicatorsFor(flat(30, 8)).averagePrice.reading).toContain("right around its average of 30¢");
  });
});

describe("momentum", () => {
  it("is 100 when the price only rises", () => {
    const result = indicatorsFor(ramp(10, 1, 30)).momentum;
    expect(result.value).toBe(100);
    expect(result.zone).toBe("overbought");
    expect(result.reading).toContain("climbing");
  });

  it("is 0 when the price only falls", () => {
    const result = indicatorsFor(ramp(80, -1, 30)).momentum;
    expect(result.value).toBe(0);
    expect(result.zone).toBe("oversold");
    expect(result.reading).toContain("falling");
  });

  it("sits near 50 for an alternating series", () => {
    const prices = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 50 : 51));
    const result = indicatorsFor(prices).momentum;
    expect(result.zone).toBe("neutral");
    expect(result.value).toBeGreaterThan(40);
    expect(result.value).toBeLessThan(60);
  });

  it("says there is nothing to measure for a flat series", () => {
    const result = indicatorsFor(flat(25, 30)).momentum;
    expect(result.value).toBeNull();
    expect(result.reading).toContain("no momentum to measure");
  });

  it("matches a hand-computed Wilder RSI", () => {
    const prices = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const result = indicatorsFor(prices).momentum;
    expect(result.value).toBeCloseTo(72.98, 1);
  });

  it("stays within 0 and 100", () => {
    for (const series of [ramp(1, 2, 40), ramp(99, -2, 40), [...flat(50, 20), 99, 1, 99]]) {
      const value = indicatorsFor(series).momentum.value;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("jumpiness and bands", () => {
  it("is calm for a flat series and never outside its band", () => {
    const result = indicatorsFor(flat(40, 25)).jumpiness;
    expect(result).toMatchObject({ value: 0, mean: 40, upper: 40, lower: 40, outsideBand: false });
    expect(result.reading).toContain("calm");
  });

  it("flags a last price outside mean ± 2σ", () => {
    const prices = [...flat(40, 19), 70];
    const result = indicatorsFor(prices).jumpiness;
    expect(result.outsideBand).toBe(true);
    expect(result.reading).toContain("outside its usual range");
    expect(result.reading).toContain("70¢");
  });

  it("calls swings inside the band jumpy without flagging", () => {
    const prices = [40, 46, 38, 47, 39, 45, 41, 44, 40, 43];
    const result = indicatorsFor(prices).jumpiness;
    expect(result.outsideBand).toBe(false);
    expect(result.value).toBeGreaterThan(1);
    expect(result.reading).toContain("jumpy");
  });

  it("clamps the band to 0..100", () => {
    const result = indicatorsFor([2, 2, 2, 2, 2, 2, 2, 2, 2, 20]).jumpiness;
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.upper).toBeLessThanOrEqual(100);
  });

  it("computes rolling overlays that are null until enough points exist", () => {
    const bands = rollingBands([10, 10, 10, 10, 10, 20]);
    expect(bands[3]).toEqual({ ma: null, upper: null, lower: null });
    expect(bands[4]).toEqual({ ma: 10, upper: 10, lower: 10 });
    expect(bands[5]?.ma).toBeCloseTo(11.67, 2);
    expect(bands[5]?.upper).toBeGreaterThan(bands[5]?.ma ?? 0);
  });

  it("limits each overlay window to 20 points", () => {
    const values = [...flat(0, 30), ...flat(100, 20)];
    expect(bandsAt(values, values.length - 1).ma).toBe(100);
  });
});

describe("volumeSpike", () => {
  const quiet = flat(10, 12);

  it("reports a multiple of the usual volume", () => {
    const prices = flat(40, 13);
    const result = indicatorsFor(prices, [...quiet, 40]).volumeSpike;
    expect(result.ratio).toBe(4);
    expect(result.reading).toBe("Volume is 4× its usual level.");
  });

  it("calls low volume quiet", () => {
    const result = indicatorsFor(flat(40, 13), [...quiet, 2]).volumeSpike;
    expect(result.ratio).toBe(0.2);
    expect(result.reading).toBe("Volume is quiet: about 20% of its usual level.");
  });

  it("says so when the latest hour had no trades", () => {
    expect(indicatorsFor(flat(40, 13), [...quiet, 0]).volumeSpike.reading).toBe("No trades in the latest hour, which is quieter than usual.");
  });

  it("calls near-average volume usual", () => {
    expect(indicatorsFor(flat(40, 13), [...quiet, 11]).volumeSpike.reading).toBe("Volume is about its usual level.");
  });

  it("tracks on-balance volume on rising prices", () => {
    const prices = [...flat(40, 8), 41, 42, 43, 44, 45];
    const volumes = [...flat(10, 8), 10, 10, 10, 10, 10];
    const result = indicatorsFor(prices, volumes).volumeSpike;
    expect(result.obvTrend).toBe("up");
    expect(result.reading).toContain("More has traded on price rises than on falls.");
  });

  it("tracks on-balance volume on falling prices", () => {
    const prices = [...flat(50, 8), 49, 48, 47, 46, 45];
    const result = indicatorsFor(prices, flat(10, 13)).volumeSpike;
    expect(result.obvTrend).toBe("down");
    expect(result.reading).toContain("price falls");
  });

  it("is flat when volume only trades at an unchanged price", () => {
    expect(indicatorsFor(flat(40, 13), flat(10, 13)).volumeSpike.obvTrend).toBe("flat");
  });

  it("does not divide by a zero average", () => {
    const quietThenTrade = indicatorsFor([...flat(40, 12), 42], [...flat(0, 12), 5]).volumeSpike;
    expect(quietThenTrade.ratio).toBeNull();
    expect(quietThenTrade.reading).toContain("picked up after a quiet stretch");
    const allZero = indicatorsFor(flat(40, 13), flat(0, 13)).volumeSpike;
    expect(allZero.ratio).toBeNull();
    expect(allZero.reading).toContain("Not enough trading yet");
  });

  it("needs six earlier points and known volumes", () => {
    expect(indicatorsFor(flat(40, 6), flat(10, 6)).volumeSpike.ratio).toBeNull();
    expect(indicatorsFor(flat(40, 13), [...flat(10, 6), null, ...flat(10, 6)]).volumeSpike.ratio).toBeNull();
    expect(indicatorsFor(flat(40, 13), [...flat(10, 12), null]).volumeSpike.ratio).toBeNull();
  });
});

describe("recentMove", () => {
  it("reports a big move in the last hour", () => {
    const prices = [...flat(40, 29), 52];
    const result = indicatorsFor(prices).recentMove;
    expect(result.hourCents).toBe(12);
    expect(result.reading).toBe("Odds jumped 12¢ in the last hour — traders are reacting quickly.");
  });

  it("reports a big drop in the last hour", () => {
    const result = indicatorsFor([...flat(60, 29), 50]).recentMove;
    expect(result.reading).toBe("Odds fell 10¢ in the last hour — traders are reacting quickly.");
  });

  it("falls back to the day move when the last hour was quiet", () => {
    const prices = [...flat(40, 5), ...ramp(40, 0.4, 25)];
    const result = indicatorsFor(prices).recentMove;
    expect(result.dayCents).toBeCloseTo(9.6, 5);
    expect(result.reading).toBe("Odds rose 9.6¢ over the last day.");
  });

  it("calls a quiet day calm", () => {
    const result = indicatorsFor(flat(40, 30)).recentMove;
    expect(result).toMatchObject({ hourCents: 0, dayCents: 0 });
    expect(result.reading).toBe("Odds are calm: they moved less than 1¢ in the last day.");
  });

  it("does not sign a zero move", () => {
    const prices = [...flat(40, 5), ...ramp(40, 0.1, 24), 42.3];
    expect(indicatorsFor(prices).recentMove.reading).toBe("Odds moved 0¢ in the last hour and +2.3¢ over the last day.");
  });

  it("summarises small signed moves", () => {
    const prices = [...flat(40, 5), ...ramp(40, 0.1, 25)];
    const result = indicatorsFor(prices).recentMove;
    expect(result.reading).toBe("Odds moved +0.1¢ in the last hour and +2.4¢ over the last day.");
  });

  it("measures only the hour when less than a day of data exists", () => {
    const result = indicatorsFor([40, 41, 42]).recentMove;
    expect(result.hourCents).toBe(1);
    expect(result.dayCents).toBeNull();
    expect(result.reading).toBe("Odds moved +1¢ in the last hour.");
  });

  it("measures against the nearest point at least an hour old when candles are sparse", () => {
    const points: IndicatorPoint[] = [
      { t: START, cents: 30, volume: 0 },
      { t: START + 5 * HOUR, cents: 38, volume: 0 },
    ];
    expect(computeIndicators(points).recentMove.hourCents).toBe(8);
  });
});
