import type { Candle, CandleTimeframe } from "@/features/markets";
import type { ProTimeframe } from "@/shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export interface TimeframePlan {
  readonly source: CandleTimeframe;
  readonly fallback: CandleTimeframe | null;
  readonly bucketMs: number | null;
  readonly windowMs: number | null;
}

export const TIMEFRAME_PLANS: Readonly<Record<ProTimeframe, TimeframePlan>> = {
  "5m": { source: "5m", fallback: "1m", bucketMs: null, windowMs: 12 * HOUR_MS },
  "1h": { source: "1hr", fallback: "15m", bucketMs: null, windowMs: 7 * DAY_MS },
  "4h": { source: "1hr", fallback: "15m", bucketMs: 4 * HOUR_MS, windowMs: 30 * DAY_MS },
  "1D": { source: "1day", fallback: "1hr", bucketMs: null, windowMs: 180 * DAY_MS },
  "1W": { source: "1day", fallback: "6hr", bucketMs: WEEK_MS, windowMs: null },
};


export function defaultProTimeframe(expiryDate: string | null, nowMs: number): ProTimeframe {
  if (expiryDate === null) return "1D";
  const remaining = Date.parse(expiryDate) - nowMs;
  if (!Number.isFinite(remaining)) return "1D";
  if (remaining > 0 && remaining <= 8 * HOUR_MS) return "5m";
  if (remaining > 0 && remaining <= 2 * DAY_MS) return "1h";
  return "1D";
}

export const STATS_CANDLE: CandleTimeframe = "1hr";
export const INDICATOR_CANDLE: CandleTimeframe = "1hr";
export const DAY_MS_VALUE = DAY_MS;
export const HOUR_MS_VALUE = HOUR_MS;


export const MIN_TRADED_CANDLES = 20;

export function isTradedCandle(candle: Candle): boolean {
  return candle.volume > 0 || candle.highCents > candle.lowCents || candle.openCents !== candle.closeCents;
}

export function tradedCount(candles: readonly Candle[]): number {
  return candles.reduce((count, candle) => count + (isTradedCandle(candle) ? 1 : 0), 0);
}

export function cropToTradedWindow(candles: readonly Candle[]): Candle[] {
  let first = -1;
  let last = -1;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle !== undefined && isTradedCandle(candle)) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0 || last < 0) return [];
  return candles.slice(first, last + 1);
}

export function pickReadableTimeframe(
  tradedByTimeframe: Readonly<Partial<Record<ProTimeframe, number>>>,
  fallback: ProTimeframe,
): ProTimeframe {
  for (const timeframe of ["5m", "1h", "4h", "1D", "1W"] as const) {
    if ((tradedByTimeframe[timeframe] ?? 0) >= MIN_TRADED_CANDLES) return timeframe;
  }
  return fallback;
}

export function aggregateCandles(candles: readonly Candle[], bucketMs: number): Candle[] {
  if (bucketMs <= 0) return [...candles].sort((a, b) => a.timeMs - b.timeMs);
  const buckets = new Map<number, Candle>();
  for (const candle of [...candles].sort((a, b) => a.timeMs - b.timeMs)) {
    const timeMs = Math.floor(candle.timeMs / bucketMs) * bucketMs;
    const existing = buckets.get(timeMs);
    if (existing === undefined) {
      buckets.set(timeMs, { ...candle, timeMs });
      continue;
    }
    buckets.set(timeMs, {
      timeMs,
      openCents: existing.openCents,
      highCents: Math.max(existing.highCents, candle.highCents),
      lowCents: Math.min(existing.lowCents, candle.lowCents),
      closeCents: candle.closeCents,
      volume: existing.volume + candle.volume,
    });
  }
  return [...buckets.values()];
}

export function planCandles(candles: readonly Candle[], timeframe: ProTimeframe, nowMs: number): Candle[] {
  const plan = TIMEFRAME_PLANS[timeframe];
  const aggregated = plan.bucketMs === null ? [...candles].sort((a, b) => a.timeMs - b.timeMs) : aggregateCandles(candles, plan.bucketMs);
  if (plan.windowMs === null) return aggregated;
  const start = nowMs - plan.windowMs;
  return aggregated.filter((candle) => candle.timeMs >= start);
}

export function planChartCandles(candles: readonly Candle[], timeframe: ProTimeframe, nowMs: number): Candle[] {
  const plan = TIMEFRAME_PLANS[timeframe];
  const aggregated = plan.bucketMs === null ? [...candles].sort((a, b) => a.timeMs - b.timeMs) : aggregateCandles(candles, plan.bucketMs);
  const allTrades = cropToTradedWindow(aggregated);
  if (tradedCount(allTrades) < MIN_TRADED_CANDLES) return allTrades;
  const windowMs = plan.windowMs;
  const windowed = windowMs === null ? aggregated : aggregated.filter((candle) => candle.timeMs >= nowMs - windowMs);
  const cropped = cropToTradedWindow(windowed);
  return cropped.length > 0 ? cropped : allTrades;
}
