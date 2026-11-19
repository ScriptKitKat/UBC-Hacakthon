import type { ResearchIndicators } from "@/shared";

export interface IndicatorPoint {
  readonly t: number;
  readonly cents: number;
  readonly volume: number | null;
}

export interface Bands {
  readonly ma: number | null;
  readonly upper: number | null;
  readonly lower: number | null;
}

export const SMA_WINDOW = 20;
export const RSI_PERIOD = 14;
export const BAND_SIGMAS = 2;
export const VOLUME_WINDOW = 24;
export const OBV_WINDOW = 12;
const MIN_AVERAGE_POINTS = 5;
const MIN_VOLUME_HISTORY = 6;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_REFERENCE_AGE_RATIO = 1.5;
const BIG_MOVE_CENTS = 5;
const CALM_MOVE_CENTS = 1;
const OVERBOUGHT = 70;
const OVERSOLD = 30;
const SPIKE_RATIO = 2;
const QUIET_RATIO = 0.5;
const NEAR_AVERAGE_CENTS = 1;
const NOT_ENOUGH = "Not enough trading yet";

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function formatCents(value: number): string {
  const rounded = round(value, 1);
  return `${String(rounded)}¢`;
}

function formatSigned(value: number): string {
  if (value === 0) return "0¢";
  return `${value < 0 ? "−" : "+"}${formatCents(Math.abs(value))}`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[], average: number): number {
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function windowEndingAt(values: readonly number[], endIndex: number, window: number): readonly number[] {
  return values.slice(Math.max(0, endIndex + 1 - window), endIndex + 1);
}

export function bandsAt(values: readonly number[], endIndex: number, window = SMA_WINDOW): Bands {
  if (endIndex + 1 < Math.min(window, MIN_AVERAGE_POINTS)) return { ma: null, upper: null, lower: null };
  const slice = windowEndingAt(values, endIndex, window);
  const average = mean(slice);
  const deviation = standardDeviation(slice, average);
  return {
    ma: round(average),
    upper: round(Math.min(100, average + BAND_SIGMAS * deviation)),
    lower: round(Math.max(0, average - BAND_SIGMAS * deviation)),
  };
}

export function rollingBands(values: readonly number[], window = SMA_WINDOW): readonly Bands[] {
  return values.map((_, index) => bandsAt(values, index, window));
}

function averagePrice(prices: readonly number[]): ResearchIndicators["averagePrice"] {
  const last = prices.at(-1);
  if (last === undefined || prices.length < MIN_AVERAGE_POINTS) {
    return { value: null, window: Math.min(prices.length, SMA_WINDOW), reading: `${NOT_ENOUGH} to work out an average price.` };
  }
  const window = Math.min(prices.length, SMA_WINDOW);
  const average = round(mean(prices.slice(-window)));
  const gap = round(last - average, 1);
  const span = `the last ${String(window)} hours`;
  if (Math.abs(gap) < NEAR_AVERAGE_CENTS) {
    return { value: average, window, reading: `The price (${formatCents(last)}) is right around its average of ${formatCents(average)} over ${span}.` };
  }
  const direction = gap > 0 ? "above" : "below";
  return {
    value: average,
    window,
    reading: `The average price over ${span} is ${formatCents(average)}. The price now (${formatCents(last)}) is ${formatCents(Math.abs(gap))} ${direction} it.`,
  };
}

function momentum(prices: readonly number[]): ResearchIndicators["momentum"] {
  if (prices.length < RSI_PERIOD + 1) {
    return { value: null, zone: null, reading: `${NOT_ENOUGH} to measure momentum.` };
  }
  const changes = prices.slice(1).map((price, index) => price - (prices[index] ?? price));
  let averageGain = mean(changes.slice(0, RSI_PERIOD).map((change) => Math.max(change, 0)));
  let averageLoss = mean(changes.slice(0, RSI_PERIOD).map((change) => Math.max(-change, 0)));
  for (const change of changes.slice(RSI_PERIOD)) {
    averageGain = (averageGain * (RSI_PERIOD - 1) + Math.max(change, 0)) / RSI_PERIOD;
    averageLoss = (averageLoss * (RSI_PERIOD - 1) + Math.max(-change, 0)) / RSI_PERIOD;
  }
  if (averageGain === 0 && averageLoss === 0) {
    return { value: null, zone: null, reading: "The price hasn't changed lately, so there's no momentum to measure." };
  }
  const value = round(averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss));
  if (value >= OVERBOUGHT) {
    return { value, zone: "overbought", reading: `Odds have mostly been climbing (momentum ${String(Math.round(value))} of 100). After a run like this, prices often pause.` };
  }
  if (value <= OVERSOLD) {
    return { value, zone: "oversold", reading: `Odds have mostly been falling (momentum ${String(Math.round(value))} of 100). After a drop like this, prices often pause.` };
  }
  return { value, zone: "neutral", reading: `Momentum is balanced (${String(Math.round(value))} of 100): no strong push up or down.` };
}

function jumpiness(prices: readonly number[]): ResearchIndicators["jumpiness"] {
  const last = prices.at(-1);
  if (last === undefined || prices.length < MIN_AVERAGE_POINTS) {
    return { value: null, mean: null, upper: null, lower: null, outsideBand: false, reading: `${NOT_ENOUGH} to tell how jumpy the odds are.` };
  }
  const slice = prices.slice(-SMA_WINDOW);
  const average = mean(slice);
  const deviation = standardDeviation(slice, average);
  const upper = Math.min(100, average + BAND_SIGMAS * deviation);
  const lower = Math.max(0, average - BAND_SIGMAS * deviation);
  const outsideBand = last > upper + 1e-9 || last < lower - 1e-9;
  const base = {
    value: round(deviation),
    mean: round(average),
    upper: round(upper),
    lower: round(lower),
    outsideBand,
  };
  if (outsideBand) {
    return {
      ...base,
      reading: `The latest price (${formatCents(last)}) is outside its usual range of ${formatCents(lower)}–${formatCents(upper)}, so this is an unusual move.`,
    };
  }
  if (deviation < CALM_MOVE_CENTS) {
    return { ...base, reading: `Odds are calm: typical variation around their average is under 1¢.` };
  }
  return { ...base, reading: `Odds are jumpy: typical variation around their average is about ${formatCents(deviation)}. The latest price is inside its usual range.` };
}

function onBalanceVolumeTrend(points: readonly IndicatorPoint[]): "up" | "down" | "flat" {
  const recent = points.slice(-(OBV_WINDOW + 1));
  let balance = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const current = recent[index];
    const previous = recent[index - 1];
    if (current === undefined || previous === undefined) continue;
    const direction = Math.sign(current.cents - previous.cents);
    balance += direction * (current.volume ?? 0);
  }
  return balance > 0 ? "up" : balance < 0 ? "down" : "flat";
}

function volumeSpike(points: readonly IndicatorPoint[]): ResearchIndicators["volumeSpike"] {
  const last = points.at(-1);
  const history = points.slice(-(VOLUME_WINDOW + 1), -1);
  if (last?.volume == null || history.length < MIN_VOLUME_HISTORY || history.some((point) => point.volume === null)) {
    return { ratio: null, obvTrend: null, reading: `${NOT_ENOUGH} to compare volume.` };
  }
  const usual = mean(history.map((point) => point.volume ?? 0));
  const obvTrend = onBalanceVolumeTrend(points);
  const pressure =
    obvTrend === "up" ? " More has traded on price rises than on falls." : obvTrend === "down" ? " More has traded on price falls than on rises." : "";
  if (usual === 0) {
    return last.volume > 0
      ? { ratio: null, obvTrend, reading: `Trading picked up after a quiet stretch.${pressure}` }
      : { ratio: null, obvTrend: null, reading: `${NOT_ENOUGH} to compare volume.` };
  }
  const ratio = round(last.volume / usual);
  const quietPercent = Math.round(ratio * 100);
  const label =
    last.volume === 0
      ? "No trades in the latest hour, which is quieter than usual."
      : ratio >= SPIKE_RATIO
        ? `Volume is ${String(round(ratio, 1))}× its usual level.`
        : ratio <= QUIET_RATIO
          ? `Volume is quiet: ${quietPercent === 0 ? "under 1%" : `about ${String(quietPercent)}%`} of its usual level.`
          : "Volume is about its usual level.";
  return { ratio, obvTrend, reading: `${label}${pressure}` };
}

function changeOver(points: readonly IndicatorPoint[], spanMs: number): number | null {
  const latest = points.at(-1);
  if (latest === undefined) return null;
  const reference = [...points].reverse().find((point) => point.t <= latest.t - spanMs);
  if (reference === undefined || latest.t - reference.t > spanMs * MAX_REFERENCE_AGE_RATIO) return null;
  return round(latest.cents - reference.cents);
}

function recentMove(points: readonly IndicatorPoint[]): ResearchIndicators["recentMove"] {
  const hourCents = changeOver(points, HOUR_MS);
  const dayCents = changeOver(points, DAY_MS);
  const move = (change: number, span: string): string =>
    `Odds ${change > 0 ? "jumped" : "fell"} ${formatCents(Math.abs(change))} in the last ${span} — traders are reacting quickly.`;
  if (hourCents === null && dayCents === null) {
    return { hourCents, dayCents, reading: `${NOT_ENOUGH} to measure recent moves.` };
  }
  if (hourCents !== null && Math.abs(hourCents) >= BIG_MOVE_CENTS) return { hourCents, dayCents, reading: move(hourCents, "hour") };
  if (dayCents !== null && Math.abs(dayCents) >= BIG_MOVE_CENTS) {
    return { hourCents, dayCents, reading: `Odds ${dayCents > 0 ? "rose" : "fell"} ${formatCents(Math.abs(dayCents))} over the last day.` };
  }
  const largest = Math.max(Math.abs(hourCents ?? 0), Math.abs(dayCents ?? 0));
  if (dayCents !== null && largest < CALM_MOVE_CENTS) {
    return { hourCents, dayCents, reading: "Odds are calm: they moved less than 1¢ in the last day." };
  }
  const parts = [
    hourCents === null ? undefined : `${formatSigned(hourCents)} in the last hour`,
    dayCents === null ? undefined : `${formatSigned(dayCents)} over the last day`,
  ].filter((part) => part !== undefined);
  return { hourCents, dayCents, reading: `Odds moved ${parts.join(" and ")}.` };
}

export function computeIndicators(points: readonly IndicatorPoint[]): ResearchIndicators {
  const prices = points.map((point) => point.cents);
  return {
    momentum: momentum(prices),
    jumpiness: jumpiness(prices),
    volumeSpike: volumeSpike(points),
    averagePrice: averagePrice(prices),
    recentMove: recentMove(points),
  };
}
