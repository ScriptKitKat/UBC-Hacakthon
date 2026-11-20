import type { Candle, CandleTimeframe, RecentTrade } from "@/features/markets";
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

export const ALL_CANDLE_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1hr", "6hr", "1day"] as const satisfies readonly CandleTimeframe[];

export const CANDLE_INTERVAL_MS: Readonly<Record<CandleTimeframe, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1hr": HOUR_MS,
  "6hr": 6 * HOUR_MS,
  "1day": DAY_MS,
};

export interface SeriesInput {
  readonly candles: readonly Candle[];
  readonly snapshots: readonly PriceSnapshot[];
  readonly trades?: readonly RecentTrade[];
  readonly windowMs: number | null;
  readonly nowMs: number;
  readonly candleIntervalMs?: number;
}

export interface MergedSeries {
  readonly source: "gemini" | "trades" | "snapshot" | "mixed" | "none";
  readonly points: readonly ResearchSeriesPoint[];
}

type BasePoint = Omit<ResearchSeriesPoint, "ma" | "upper" | "lower">;
type PointSource = BasePoint["source"];

function overallSource(points: readonly BasePoint[]): MergedSeries["source"] {
  const kinds = new Set(points.map((point) => point.source));
  if (kinds.size === 0) return "none";
  if (kinds.size === 1) {
    const only = [...kinds][0];
    return only === "gemini" || only === "trades" || only === "snapshot" ? only : "none";
  }
  return "mixed";
}

function inferIntervalMs(candles: readonly Candle[]): number {
  if (candles.length < 3) return 60_000;
  const diffs = [];
  for (let index = 1; index < candles.length; index += 1) {
    const gap = (candles[index]?.timeMs ?? 0) - (candles[index - 1]?.timeMs ?? 0);
    if (gap > 0) diffs.push(gap);
  }
  if (diffs.length === 0) return 60_000;
  diffs.sort((left, right) => left - right);
  return diffs[Math.floor(diffs.length / 2)] ?? 60_000;
}

function keepAuxiliary(t: number, candles: readonly Candle[], intervalMs: number, lastStart: number): boolean {
  if (t > lastStart) return true;
  return !candles.some((candle) => t >= candle.timeMs && t < candle.timeMs + intervalMs);
}

function sourceRank(source: PointSource): number {
  return source === "gemini" ? 0 : source === "trades" ? 1 : 2;
}

export function mergeSeries(input: SeriesInput): MergedSeries {
  const earliest = input.windowMs === null ? Number.NEGATIVE_INFINITY : input.nowMs - input.windowMs;
  const candles = [...input.candles]
    .sort((a, b) => a.timeMs - b.timeMs)
    .filter((candle) => candle.timeMs >= earliest && candle.timeMs <= input.nowMs);
  const intervalMs = input.candleIntervalMs ?? inferIntervalMs(candles);
  const lastStart = candles.reduce((latest, candle) => Math.max(latest, candle.timeMs), Number.NEGATIVE_INFINITY);
  const fromCandles: BasePoint[] = candles.map((candle) => ({ t: candle.timeMs, cents: candle.closeCents, volume: candle.volume, source: "gemini", bidCents: null, askCents: null }));
  const fromTrades: BasePoint[] = (input.trades ?? [])
    .filter((trade) => trade.timeMs >= earliest && trade.timeMs <= input.nowMs && keepAuxiliary(trade.timeMs, candles, intervalMs, lastStart))
    .map((trade) => ({ t: trade.timeMs, cents: trade.priceCents, volume: trade.amount, source: "trades", bidCents: null, askCents: null }));
  const fromSnapshots: BasePoint[] = input.snapshots
    .filter((snapshot) => snapshot.atMs >= earliest && snapshot.atMs <= input.nowMs && keepAuxiliary(snapshot.atMs, candles, intervalMs, lastStart))
    .map((snapshot) => ({ t: snapshot.atMs, cents: snapshot.yesCents, volume: null, source: "snapshot", bidCents: snapshot.bidCents, askCents: snapshot.askCents }));
  const ranked = [...fromCandles, ...fromTrades, ...fromSnapshots].sort((left, right) => left.t - right.t || sourceRank(left.source) - sourceRank(right.source));
  const seen = new Set<number>();
  const base: BasePoint[] = [];
  for (const point of ranked) {
    if (seen.has(point.t)) continue;
    seen.add(point.t);
    base.push(point);
  }
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
