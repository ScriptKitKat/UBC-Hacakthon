export const MIN_SPARKLINE_POINTS = 3;
const MIN_RANGE_CENTS = 4;
const PADDING = 2;

export type Trend = "up" | "down" | "flat";

export interface Sparkline {
  readonly line: string;
  readonly area: string;
  readonly end: { readonly x: number; readonly y: number };
  readonly trend: Trend;
}

function round(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function buildSparkline(values: readonly number[], width: number, height: number): Sparkline | undefined {
  const first = values[0];
  const last = values.at(-1);
  if (new Set(values).size < MIN_SPARKLINE_POINTS || first === undefined || last === undefined) return undefined;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, MIN_RANGE_CENTS);
  const mid = (high + low) / 2;
  const innerWidth = width - PADDING * 2;
  const innerHeight = height - PADDING * 2;
  const points = values.map((value, index) => ({
    x: PADDING + (index / (values.length - 1)) * innerWidth,
    y: PADDING + (1 - (value - (mid - range / 2)) / range) * innerHeight,
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`).join(" ");
  const end = points.at(-1) ?? { x: width - PADDING, y: height / 2 };
  const area = `${line} L${round(end.x)} ${String(height)} L${round(PADDING)} ${String(height)} Z`;
  const trend: Trend = last > first ? "up" : last < first ? "down" : "flat";
  return { line, area, end, trend };
}
