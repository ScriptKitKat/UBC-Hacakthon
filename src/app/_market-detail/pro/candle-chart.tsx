import type { ProChart, ProTimeframe } from "@/shared";
import { formatAxisTime, formatCents } from "./format";
import styles from "./pro.module.css";

const WIDTH = 900;
const HEIGHT = 300;
const PRICE_TOP = 10;
const PRICE_BOTTOM = 210;
const VOL_TOP = 220;
const VOL_BOTTOM = 250;
const RSI_TOP = 258;
const RSI_BOTTOM = 292;

const TIMEFRAMES: readonly ProTimeframe[] = ["5m", "1h", "4h", "1D", "1W"];

function yOf(value: number, min: number, max: number, top: number, bottom: number): number {
  if (max === min) return (top + bottom) / 2;
  return top + ((max - value) / (max - min)) * (bottom - top);
}

export function CandleChart({
  chart,
  timeframe,
  onTimeframe,
  spotLabel,
}: {
  readonly chart: ProChart;
  readonly timeframe: ProTimeframe;
  readonly onTimeframe: (timeframe: ProTimeframe) => void;
  readonly spotLabel: string | null;
}) {
  const candles = chart.candles;
  const highs = candles.map((candle) => candle.highCents);
  const lows = candles.map((candle) => candle.lowCents);
  const bandHighs = chart.bands.map((band) => band.upper).filter((value): value is number => value !== null);
  const bandLows = chart.bands.map((band) => band.lower).filter((value): value is number => value !== null);
  const max = candles.length === 0 ? 1 : Math.max(...highs, ...bandHighs);
  const min = candles.length === 0 ? 0 : Math.min(...lows, ...bandLows);
  const last = candles[candles.length - 1]?.closeCents ?? null;
  const step = candles.length === 0 ? WIDTH : WIDTH / candles.length;
  const body = step * 0.6;
  const volMax = Math.max(1, ...candles.map((candle) => candle.volume));
  const priceY = (value: number) => yOf(value, min, max, PRICE_TOP, PRICE_BOTTOM);
  const rsiY = (value: number) => yOf(value, 0, 100, RSI_TOP, RSI_BOTTOM);
  const xOf = (index: number) => step * index + step / 2;
  const upBodies: string[] = [];
  const downBodies: string[] = [];
  const upVol: string[] = [];
  const downVol: string[] = [];
  const wicks: string[] = [];
  candles.forEach((candle, index) => {
    const x = xOf(index);
    const up = candle.closeCents >= candle.openCents;
    const top = priceY(Math.max(candle.openCents, candle.closeCents));
    const bottom = priceY(Math.min(candle.openCents, candle.closeCents));
    const rect = `M ${String(x - body / 2)} ${String(top)} H ${String(x + body / 2)} V ${String(Math.max(bottom, top + 1))} H ${String(x - body / 2)} Z`;
    const volHeight = (candle.volume / volMax) * (VOL_BOTTOM - VOL_TOP);
    const vbar = `M ${String(x - body / 2)} ${String(VOL_BOTTOM - volHeight)} H ${String(x + body / 2)} V ${String(VOL_BOTTOM)} H ${String(x - body / 2)} Z`;
    wicks.push(`M ${String(x)} ${String(priceY(candle.highCents))} V ${String(priceY(candle.lowCents))}`);
    if (up) {
      upBodies.push(rect);
      upVol.push(vbar);
    } else {
      downBodies.push(rect);
      downVol.push(vbar);
    }
  });
  const firstValue = (values: readonly (number | null)[]) => values.findIndex((value) => value !== null);
  const line = (values: readonly (number | null)[], mapY: (value: number) => number) => {
    const start = firstValue(values);
    return values
      .map((value, index) => (value === null ? null : `${index === start ? "M" : "L"} ${xOf(index).toFixed(1)} ${mapY(value).toFixed(1)}`))
      .filter((part): part is string => part !== null)
      .join(" ");
  };
  const bbPath = (() => {
    const topLine = chart.bands.flatMap((band, index) => (band.upper === null ? [] : [[xOf(index), priceY(band.upper)] as const]));
    const bottomLine = chart.bands.flatMap((band, index) => (band.lower === null ? [] : [[xOf(index), priceY(band.lower)] as const])).reverse();
    if (topLine.length === 0 || bottomLine.length === 0) return "";
    return `M ${topLine.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" L ")} L ${bottomLine.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" L ")} Z`;
  })();
  const lastIndex = candles.length - 1;
  const ticks = [0, Math.floor(lastIndex / 3), Math.floor((2 * lastIndex) / 3), lastIndex]
    .filter((index, position, list) => index >= 0 && candles[index] !== undefined && list.indexOf(index) === position);
  const lastY = last === null ? null : priceY(last);
  return (
    <section className={styles.panel} aria-label="Price chart">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>YES price</h2>
        <div className={styles.timeframes} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((item) => (
            <button key={item} type="button" aria-pressed={item === timeframe} onClick={() => { onTimeframe(item); }}>
              {item}
            </button>
          ))}
        </div>
        <div className={styles.panelMeta}>
          <span>MA 7 {chart.ma7Last === null ? "—" : formatCents(chart.ma7Last).replace("¢", "")}</span>
          <span>MA 20 {chart.ma20Last === null ? "—" : formatCents(chart.ma20Last).replace("¢", "")}</span>
          <span>
            BB 20,2 {chart.bbLower === null || chart.bbUpper === null
              ? "—"
              : `${formatCents(chart.bbLower).replace("¢", "")}–${formatCents(chart.bbUpper).replace("¢", "")}`}
          </span>
          <span>{spotLabel ?? "— Spot overlay unavailable"}</span>
        </div>
      </div>
      {candles.length === 0 ? (
        <p className={styles.empty}>Gemini has no candle history for this contract yet.</p>
      ) : (
        <>
          <svg className={styles.chart} role="img" aria-label="Candlestick chart of YES price" viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} preserveAspectRatio="none">
            {bbPath !== "" ? <path d={bbPath} fill="rgba(161,161,170,0.12)" stroke="none" /> : null}
            <path d={line(chart.bands.map((band) => band.upper), priceY)} fill="none" stroke="#8a8a93" strokeWidth="1" opacity="0.6" />
            <path d={line(chart.bands.map((band) => band.lower), priceY)} fill="none" stroke="#8a8a93" strokeWidth="1" opacity="0.6" />
            <path d={line(chart.bands.map((band) => band.ma20), priceY)} fill="none" stroke="#f5a524" strokeWidth="1.2" />
            <path d={line(chart.bands.map((band) => band.ma7), priceY)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" />
            <path d={wicks.join(" ")} stroke="#a1a1aa" strokeWidth="1" />
            <path d={upBodies.join(" ")} fill="#3ddc97" />
            <path d={downBodies.join(" ")} fill="#ff9a7a" />
            <path d={upVol.join(" ")} fill="#3ddc97" opacity="0.45" />
            <path d={downVol.join(" ")} fill="#ff9a7a" opacity="0.45" />
            <path d={line(chart.bands.map((band) => band.rsi), rsiY)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" />
            <line x1="0" x2={String(WIDTH)} y1={String(rsiY(70))} y2={String(rsiY(70))} stroke="#262626" strokeWidth="1" />
            <line x1="0" x2={String(WIDTH)} y1={String(rsiY(30))} y2={String(rsiY(30))} stroke="#262626" strokeWidth="1" />
            {last !== null && lastY !== null ? (
              <>
                <line x1="0" x2={String(WIDTH)} y1={String(lastY)} y2={String(lastY)} stroke="#262626" strokeDasharray="3 3" />
                <text x={String(WIDTH - 4)} y={String(lastY - 6)} textAnchor="end" fill="#ededed" fontSize="11">{formatCents(last)}</text>
              </>
            ) : null}
          </svg>
          <div className={styles.chartLabels}>
            {ticks.map((index) => {
              const candle = candles[index];
              return candle === undefined ? null : <span key={`${String(candle.timeMs)}-${String(index)}`}>{formatAxisTime(candle.timeMs, timeframe)}</span>;
            })}
          </div>
          <p className={styles.rsiLabel}>RSI 14 {chart.rsiLast === null ? "—" : String(Math.round(chart.rsiLast))}</p>
        </>
      )}
    </section>
  );
}
