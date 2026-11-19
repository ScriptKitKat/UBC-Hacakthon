import type { Candle, CandleTimeframe } from "@/features/markets";
import type { ProTimeframe } from "@/shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export interface TimeframePlan {
  readonly source: CandleTimeframe;
  readonly bucketMs: number | null;
  readonly windowMs: number | null;
}

export const TIMEFRAME_PLANS: Readonly<Record<ProTimeframe, TimeframePlan>> = {
  "5m": { source: "5m", bucketMs: null, windowMs: 12 * HOUR_MS },
  "1h": { source: "1hr", bucketMs: null, windowMs: 7 * DAY_MS },
  "4h": { source: "1hr", bucketMs: 4 * HOUR_MS, windowMs: 30 * DAY_MS },
  "1D": { source: "1day", bucketMs: null, windowMs: 180 * DAY_MS },
  "1W": { source: "1day", bucketMs: WEEK_MS, windowMs: null },
};

export const STATS_CANDLE: CandleTimeframe = "1hr";
export const INDICATOR_CANDLE: CandleTimeframe = "1hr";
export const DAY_MS_VALUE = DAY_MS;
export const HOUR_MS_VALUE = HOUR_MS;

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
