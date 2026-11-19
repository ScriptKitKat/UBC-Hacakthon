import type { Candle, CandleTimeframe } from "@/features/markets";
import type { PriceSnapshot } from "@/features/history";
import type { ResearchSeriesPoint, ResearchTimeframe } from "@/shared";
import { rollingBands } from "./indicators";
import type { IndicatorPoint } from "./indicators";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface TimeframePlan {
  readonly candle: CandleTimeframe;
  readonly windowMs: number | null;
}

export const TIMEFRAME_PLANS: Readonly<Record<ResearchTimeframe, TimeframePlan>> = {
  "1H": { candle: "1m", windowMs: HOUR_MS },
  "1D": { candle: "15m", windowMs: DAY_MS },
  "1W": { candle: "1hr", windowMs: 7 * DAY_MS },
  "1M": { candle: "6hr", windowMs: 30 * DAY_MS },
  All: { candle: "1day", windowMs: null },
};

export const INDICATOR_CANDLE: CandleTimeframe = "1hr";

export interface SeriesInput {
  readonly candles: readonly Candle[];
  readonly snapshots: readonly PriceSnapshot[];
  readonly windowMs: number | null;
  readonly nowMs: number;
}

export interface MergedSeries {
  readonly source: "gemini" | "snapshot" | "mixed" | "none";
  readonly points: readonly ResearchSeriesPoint[];
}

type BasePoint = Omit<ResearchSeriesPoint, "ma" | "upper" | "lower">;

function overallSource(points: readonly BasePoint[]): MergedSeries["source"] {
  const gemini = points.some((point) => point.source === "gemini");
  const snapshot = points.some((point) => point.source === "snapshot");
  if (gemini && snapshot) return "mixed";
  return gemini ? "gemini" : snapshot ? "snapshot" : "none";
}

export function mergeSeries(input: SeriesInput): MergedSeries {
  const earliest = input.windowMs === null ? Number.NEGATIVE_INFINITY : input.nowMs - input.windowMs;
  const fromCandles: BasePoint[] = [...input.candles]
    .sort((a, b) => a.timeMs - b.timeMs)
    .filter((candle) => candle.timeMs >= earliest)
    .map((candle) => ({ t: candle.timeMs, cents: candle.closeCents, volume: candle.volume, source: "gemini", bidCents: null, askCents: null }));
  const lastCandleStart = input.candles.reduce((latest, candle) => Math.max(latest, candle.timeMs), Number.NEGATIVE_INFINITY);
  const fromSnapshots: BasePoint[] = input.snapshots
    .filter((snapshot) => snapshot.atMs >= earliest && snapshot.atMs > lastCandleStart && snapshot.atMs <= input.nowMs)
    .map((snapshot) => ({ t: snapshot.atMs, cents: snapshot.yesCents, volume: null, source: "snapshot", bidCents: snapshot.bidCents, askCents: snapshot.askCents }));
  const base = [...fromCandles, ...fromSnapshots].sort((a, b) => a.t - b.t);
  const bands = rollingBands(base.map((point) => point.cents));
  return {
    source: overallSource(base),
    points: base.map((point, index) => ({
      ...point,
      ma: bands[index]?.ma ?? null,
      upper: bands[index]?.upper ?? null,
      lower: bands[index]?.lower ?? null,
    })),
  };
}

export function hourlyIndicatorPoints(candles: readonly Candle[], snapshots: readonly PriceSnapshot[]): readonly IndicatorPoint[] {
  if (candles.length > 0) {
    return [...candles]
      .sort((a, b) => a.timeMs - b.timeMs)
      .map((candle) => ({ t: candle.timeMs, cents: candle.closeCents, volume: candle.volume }));
  }
  const byHour = new Map<number, IndicatorPoint>();
  for (const snapshot of snapshots) {
    const bucket = Math.floor(snapshot.atMs / HOUR_MS) * HOUR_MS;
    byHour.set(bucket, { t: bucket, cents: snapshot.yesCents, volume: null });
  }
  return [...byHour.values()].sort((a, b) => a.t - b.t);
}

export interface DepthLevel {
  readonly priceCents: number;
  readonly amount: number;
  readonly cumulative: number;
}

export const DEPTH_LEVELS = 15;

export function cumulativeDepth(levels: readonly { readonly priceCents: number; readonly amount: number }[], side: "bids" | "asks"): readonly DepthLevel[] {
  const ordered = [...levels].sort((a, b) => (side === "bids" ? b.priceCents - a.priceCents : a.priceCents - b.priceCents)).slice(0, DEPTH_LEVELS);
  let running = 0;
  return ordered.map((level) => {
    running += level.amount;
    return { priceCents: level.priceCents, amount: level.amount, cumulative: Math.round(running * 100) / 100 };
  });
}
