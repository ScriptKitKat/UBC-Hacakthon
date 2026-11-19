import type { ResearchSeriesPoint } from "@/shared";

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  readonly volumeHeight: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly gap: number;
  readonly axisBottom: number;
}

export interface YTick {
  readonly value: number;
  readonly y: number;
}

export interface XTick {
  readonly t: number;
  readonly x: number;
}

export interface VolumeBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartGeometry {
  readonly line: string;
  readonly average: string;
  readonly band: string;
  readonly bars: readonly VolumeBar[];
  readonly yTicks: readonly YTick[];
  readonly xTicks: readonly XTick[];
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly plotBottom: number;
  readonly plotTop: number;
  readonly spanMs: number;
}

export const DEFAULT_BOX: ChartBox = { width: 900, height: 360, volumeHeight: 56, left: 44, right: 14, top: 12, gap: 10, axisBottom: 22 };

const FULL_RANGE: readonly [number, number] = [0, 100];
const ZOOM_PADDING_CENTS = 2;
const MIN_ZOOM_SPAN_CENTS = 6;
const X_TICK_COUNT = 5;

function fixed(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function pathThrough(coordinates: readonly (readonly [number, number])[]): string {
  return coordinates.map(([x, y], index) => `${index === 0 ? "M" : "L"}${fixed(x)} ${fixed(y)}`).join(" ");
}

export function valueRange(points: readonly ResearchSeriesPoint[], zoom: boolean): readonly [number, number] {
  if (!zoom || points.length === 0) return FULL_RANGE;
  const values = points.flatMap((point) => [point.cents, point.lower ?? point.cents, point.upper ?? point.cents]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low + ZOOM_PADDING_CENTS * 2, MIN_ZOOM_SPAN_CENTS);
  const middle = (high + low) / 2;
  const start = Math.max(0, Math.min(100 - span, middle - span / 2));
  return [Math.floor(start), Math.min(100, Math.ceil(start + span))];
}

function niceTicks(range: readonly [number, number]): readonly number[] {
  const [low, high] = range;
  const span = high - low;
  const step = span <= 10 ? 2 : span <= 25 ? 5 : span <= 50 ? 10 : 25;
  const first = Math.ceil(low / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= high; value += step) ticks.push(value);
  return ticks;
}

export function buildChartGeometry(points: readonly ResearchSeriesPoint[], zoom: boolean, box: ChartBox = DEFAULT_BOX): ChartGeometry {
  const plotTop = box.top;
  const plotBottom = box.height - box.volumeHeight - box.gap - box.axisBottom;
  const volumeBottom = box.height - box.axisBottom;
  const left = box.left;
  const right = box.width - box.right;
  const first = points[0]?.t ?? 0;
  const last = points.at(-1)?.t ?? first;
  const spanMs = Math.max(1, last - first);
  const range = valueRange(points, zoom);
  const xOf = (t: number): number => (points.length < 2 ? (left + right) / 2 : left + ((t - first) / spanMs) * (right - left));
  const yOf = (cents: number): number => plotBottom - ((cents - range[0]) / (range[1] - range[0])) * (plotBottom - plotTop);
  const xs = points.map((point) => xOf(point.t));
  const ys = points.map((point) => yOf(point.cents));
  const averageRun = points.flatMap((point, index) => (point.ma === null ? [] : [[xs[index] ?? 0, yOf(point.ma)] as const]));
  const bandRun = points.flatMap((point, index) =>
    point.upper === null || point.lower === null ? [] : [{ x: xs[index] ?? 0, upper: yOf(point.upper), lower: yOf(point.lower) }],
  );
  const band =
    bandRun.length < 2
      ? ""
      : `${pathThrough(bandRun.map((entry) => [entry.x, entry.upper] as const))} ${[...bandRun]
          .reverse()
          .map((entry) => `L${fixed(entry.x)} ${fixed(entry.lower)}`)
          .join(" ")} Z`;
  const gaps = xs.slice(1).map((x, index) => x - (xs[index] ?? x));
  const minGap = gaps.length === 0 ? 8 : Math.max(1, Math.min(...gaps.filter((gap) => gap > 0), right - left));
  const barWidth = Math.max(1, Math.min(14, minGap * 0.7));
  const maxVolume = Math.max(0, ...points.map((point) => point.volume ?? 0));
  const bars: VolumeBar[] = points.flatMap((point, index) => {
    const volume = point.volume ?? 0;
    if (volume <= 0 || maxVolume <= 0) return [];
    const height = Math.max(1, (volume / maxVolume) * box.volumeHeight);
    return [{ x: (xs[index] ?? 0) - barWidth / 2, y: volumeBottom - height, width: barWidth, height }];
  });
  const xTicks: XTick[] =
    points.length < 2
      ? []
      : Array.from({ length: X_TICK_COUNT }, (_, index) => {
          const t = first + (spanMs * index) / (X_TICK_COUNT - 1);
          return { t, x: xOf(t) };
        });
  return {
    line: pathThrough(points.map((_, index) => [xs[index] ?? 0, ys[index] ?? 0] as const)),
    average: pathThrough(averageRun),
    band,
    bars,
    yTicks: niceTicks(range).map((value) => ({ value, y: yOf(value) })),
    xTicks,
    xs,
    ys,
    plotBottom,
    plotTop,
    spanMs,
  };
}

export function nearestIndex(xs: readonly number[], x: number): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  xs.forEach((candidate, index) => {
    const distance = Math.abs(candidate - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
