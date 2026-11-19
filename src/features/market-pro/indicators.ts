import type { Candle } from "@/features/markets";
import type { ProBandPoint, ProIndicatorRow } from "@/shared";

const SMA_FAST = 7;
const SMA_SLOW = 20;
const RSI_PERIOD = 14;
const BAND_SIGMAS = 2;
const STD_WINDOW = 7;
const OBV_WINDOW = 7;
const VOLUME_WINDOW = 7;

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function smaAt(values: readonly number[], endIndex: number, window: number): number | null {
  if (window <= 0 || endIndex < window - 1 || endIndex >= values.length) return null;
  const slice = values.slice(endIndex - window + 1, endIndex + 1);
  return mean(slice);
}

export function rollingSma(values: readonly number[], window: number): readonly (number | null)[] {
  return values.map((_, index) => smaAt(values, index, window));
}

export function bollingerAt(values: readonly number[], endIndex: number, window = SMA_SLOW, sigmas = BAND_SIGMAS): {
  readonly middle: number | null;
  readonly upper: number | null;
  readonly lower: number | null;
} {
  const middle = smaAt(values, endIndex, window);
  if (middle === null) return { middle: null, upper: null, lower: null };
  const slice = values.slice(endIndex - window + 1, endIndex + 1);
  const deviation = stdDev(slice);
  if (deviation === null) return { middle, upper: null, lower: null };
  return { middle, upper: middle + sigmas * deviation, lower: middle - sigmas * deviation };
}

export function rsiSeries(closes: readonly number[], period = RSI_PERIOD): readonly (number | null)[] {
  if (closes.length === 0) return [];
  const result: (number | null)[] = [null];
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (previous === undefined || current === undefined) {
      result.push(null);
      continue;
    }
    const change = current - previous;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index < period) {
      gains += gain;
      losses += loss;
      result.push(null);
      continue;
    }
    if (index === period) {
      gains = (gains + gain) / period;
      losses = (losses + loss) / period;
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
    }
    if (losses === 0) {
      result.push(gains === 0 ? 50 : 100);
      continue;
    }
    result.push(100 - 100 / (1 + gains / losses));
  }
  return result;
}

export function percentB(close: number, lower: number, upper: number): number | null {
  const width = upper - lower;
  if (width === 0) return null;
  return (close - lower) / width;
}

export function onBalanceVolume(candles: readonly Candle[]): number[] {
  const result: number[] = [];
  let running = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (candle === undefined) continue;
    if (previous === undefined) {
      result.push(0);
      continue;
    }
    if (candle.closeCents > previous.closeCents) running += candle.volume;
    else if (candle.closeCents < previous.closeCents) running -= candle.volume;
    result.push(running);
  }
  return result;
}

export function slope(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const start = values[0];
  const end = values[values.length - 1];
  if (start === undefined || end === undefined) return null;
  return end - start;
}

export function changeOver(candles: readonly Candle[], nowMs: number, lookbackMs: number): number | null {
  const current = [...candles].reverse().find((candle) => candle.timeMs <= nowMs);
  if (current === undefined) return null;
  const earlier = [...candles].reverse().find((candle) => candle.timeMs <= nowMs - lookbackMs);
  if (earlier === undefined) return null;
  return current.closeCents - earlier.closeCents;
}

export function chartBands(candles: readonly Candle[]): readonly ProBandPoint[] {
  const closes = candles.map((candle) => candle.closeCents);
  const ma7 = rollingSma(closes, SMA_FAST);
  const rsi = rsiSeries(closes);
  return candles.map((candle, index) => {
    const bands = bollingerAt(closes, index);
    return {
      timeMs: candle.timeMs,
      ma7: ma7[index] ?? null,
      ma20: bands.middle,
      upper: bands.upper,
      lower: bands.lower,
      rsi: rsi[index] ?? null,
    };
  });
}

function formatCents(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(Math.abs(rounded % 1) < 0.05 ? 0 : 1);
}

function signed(value: number, suffix = ""): string {
  const text = formatCents(Math.abs(value));
  if (value > 0) return `+${text}${suffix}`;
  if (value < 0) return `−${text}${suffix}`;
  return `0${suffix}`;
}

function lastOf<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

export function indicatorRows(input: {
  readonly hourly: readonly Candle[];
  readonly nowMs: number;
  readonly lastCents: number | null;
  readonly depthPlusMinus5: number | null;
}): readonly ProIndicatorRow[] {
  const { hourly, nowMs, lastCents, depthPlusMinus5 } = input;
  const closes = hourly.map((candle) => candle.closeCents);
  const lastIndex = closes.length - 1;
  const lastClose = lastCents ?? lastOf(closes) ?? null;
  const hourChange = changeOver(hourly, nowMs, 60 * 60 * 1000);
  const dayChange = changeOver(hourly, nowMs, 24 * 60 * 60 * 1000);
  const ma7 = smaAt(closes, lastIndex, SMA_FAST);
  const slow = bollingerAt(closes, lastIndex);
  const rsi = lastOf(rsiSeries(closes)) ?? null;
  const bands = lastClose !== null && slow.lower !== null && slow.upper !== null ? percentB(lastClose, slow.lower, slow.upper) : null;
  const recentCloses = closes.slice(-STD_WINDOW);
  const deviation = stdDev(recentCloses);
  const obv = onBalanceVolume(hourly);
  const obvSlope = slope(obv.slice(-OBV_WINDOW));
  const volumes = hourly.map((candle) => candle.volume);
  const lastDayVolume = volumes.slice(-24).reduce((sum, value) => sum + value, 0);
  const weekVolume = volumes.slice(-24 * VOLUME_WINDOW).reduce((sum, value) => sum + value, 0);
  const weekAvg = hourly.length >= 24 ? weekVolume / Math.min(VOLUME_WINDOW, Math.max(1, Math.floor(hourly.length / 24))) : null;
  const volumeRatio = weekAvg !== null && weekAvg > 0 ? lastDayVolume / weekAvg : null;

  const momentumMissing = hourChange === null && dayChange === null ? "Not enough recent candles to measure momentum." : null;
  const maMissing = ma7 === null || slow.middle === null ? "Need at least 20 hourly closes for the moving averages." : null;
  const rsiMissing = rsi === null ? "Need at least 15 hourly closes for RSI 14." : null;
  const bbMissing = bands === null ? "Need 20 hourly closes for Bollinger bands." : null;
  const stdMissing = deviation === null ? "Need at least two recent closes for a standard deviation." : null;
  const obvMissing = obvSlope === null ? "Need more volume history for an OBV slope." : null;
  const volMissing = volumeRatio === null ? "Need about a week of hourly volume to compare today with the average." : null;
  const depthMissing = depthPlusMinus5 === null ? "The order book is unavailable, so depth cannot be measured." : null;

  const golden = ma7 !== null && slow.middle !== null && ma7 > slow.middle;
  const death = ma7 !== null && slow.middle !== null && ma7 < slow.middle;
  const rsiSignal = rsi === null ? null : rsi >= 70 ? "Stretched" : rsi <= 30 ? "Oversold" : "Neutral";
  const bbSignal = bands === null ? null : bands >= 0.8 ? "Near upper band" : bands <= 0.2 ? "Near lower band" : "Mid band";
  const stdSignal = deviation === null ? null : deviation >= 4 ? "High" : deviation <= 1 ? "Low" : "Typical";
  const obvSignal = obvSlope === null ? null : obvSlope > 0 ? "Confirms" : obvSlope < 0 ? "Diverges" : "Flat";
  const volSignal = volumeRatio === null ? null : volumeRatio >= 2 ? "Spike" : volumeRatio <= 0.5 ? "Quiet" : "Typical";
  const depthSignal = depthPlusMinus5 === null ? null : depthPlusMinus5 >= 2000 ? "OK" : "Thin";

  return [
    {
      key: "momentum",
      label: "Momentum 1h / 24h",
      value: hourChange === null && dayChange === null ? null : `${hourChange === null ? "—" : signed(hourChange)} / ${dayChange === null ? "—" : signed(dayChange)}`,
      signal: dayChange === null ? null : dayChange > 0 ? "Up" : dayChange < 0 ? "Down" : "Flat",
      tone: dayChange === null ? "neutral" : dayChange > 0 ? "up" : dayChange < 0 ? "down" : "neutral",
      missing: momentumMissing,
    },
    {
      key: "ma-cross",
      label: "MA 7 vs MA 20",
      value: ma7 === null || slow.middle === null ? null : `${formatCents(ma7)} / ${formatCents(slow.middle)}`,
      signal: golden ? "Golden cross" : death ? "Death cross" : maMissing === null ? "Tied" : null,
      tone: golden ? "up" : death ? "down" : "neutral",
      missing: maMissing,
    },
    {
      key: "rsi",
      label: "RSI 14",
      value: rsi === null ? null : formatCents(rsi),
      signal: rsiSignal,
      tone: rsi === null ? "neutral" : rsi >= 70 || rsi <= 30 ? "warn" : "neutral",
      missing: rsiMissing,
    },
    {
      key: "percent-b",
      label: "Bollinger %B",
      value: bands === null ? null : bands.toFixed(2),
      signal: bbSignal,
      tone: bands !== null && (bands >= 0.8 || bands <= 0.2) ? "warn" : "neutral",
      missing: bbMissing,
    },
    {
      key: "stdev",
      label: "Rolling std. dev. 7d",
      value: deviation === null ? null : `${formatCents(deviation)} pts`,
      signal: stdSignal,
      tone: deviation !== null && deviation >= 4 ? "warn" : "neutral",
      missing: stdMissing,
    },
    {
      key: "obv",
      label: "OBV slope 7d",
      value: obvSlope === null ? null : signed(obvSlope),
      signal: obvSignal,
      tone: obvSlope === null ? "neutral" : obvSlope > 0 ? "up" : obvSlope < 0 ? "down" : "neutral",
      missing: obvMissing,
    },
    {
      key: "volume",
      label: "Volume vs 7d avg",
      value: volumeRatio === null ? null : `${volumeRatio.toFixed(1)}x`,
      signal: volSignal,
      tone: volumeRatio !== null && volumeRatio >= 2 ? "warn" : "neutral",
      missing: volMissing,
    },
    {
      key: "depth",
      label: "Depth ±5¢",
      value: depthPlusMinus5 === null ? null : formatUsd(depthPlusMinus5),
      signal: depthSignal,
      tone: "neutral",
      missing: depthMissing,
    },
  ];
}

function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    const thousands = amount / 1000;
    const text = Math.abs(thousands) >= 10 ? thousands.toFixed(0) : thousands.toFixed(1);
    return `$${text.replace(/\.0$/u, "")}k`;
  }
  return `$${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}
