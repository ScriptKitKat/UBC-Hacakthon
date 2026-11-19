"use client";

import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { RESEARCH_TIMEFRAMES } from "@/shared";
import type { ResearchTimeframe, ResearchView } from "@/shared";
import { DEFAULT_BOX, buildChartGeometry, nearestIndex } from "./chart-geometry";
import { formatAxisTime, formatFullTime, formatPriceCents, formatVolume } from "./format";
import { Tip } from "./tip";
import styles from "./research.module.css";

const TIMEFRAME_LABELS: Record<ResearchTimeframe, string> = { "1H": "1H", "1D": "1D", "1W": "1W", "1M": "1M", All: "All" };

const SOURCE_LABELS = { gemini: "Gemini candles", snapshot: "Desk snapshots" } as const;

export interface PriceChartProps {
  readonly series: ResearchView["series"];
  readonly timeframe: ResearchTimeframe;
  readonly onTimeframe: (timeframe: ResearchTimeframe) => void;
  readonly showOverlays: boolean;
}

export function PriceChart({ series, timeframe, onTimeframe, showOverlays }: PriceChartProps) {
  const [zoom, setZoom] = useState(false);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const { points } = series;
  const geometry = buildChartGeometry(points, zoom);
  const hovered = hover === undefined ? undefined : points[hover];
  const hoverX = hover === undefined ? undefined : geometry.xs[hover];
  const hoverY = hover === undefined ? undefined : geometry.ys[hover];
  const sources = (["gemini", "snapshot"] as const).filter((source) => points.some((point) => point.source === source));

  const moveTo = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * DEFAULT_BOX.width;
    setHover(nearestIndex(geometry.xs, x));
  };

  const keyMove = (event: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const current = hover ?? points.length - 1;
    if (event.key === "ArrowLeft") setHover(Math.max(0, current - 1));
    else if (event.key === "ArrowRight") setHover(Math.min(points.length - 1, current + 1));
    else if (event.key === "Escape") setHover(undefined);
    else return;
    event.preventDefault();
  };

  return (
    <section className={styles.panelWide} aria-labelledby="chart-heading">
      <div className={styles.chartHead}>
        <h2 id="chart-heading" className={styles.panelTitle}>
          <Tip text="The price of YES in cents over time. 62¢ means the market gives it about a 62% chance.">Odds over time</Tip>
        </h2>
        <div className={styles.chartControls}>
          <div className={styles.segmented} role="group" aria-label="Time range">
            {RESEARCH_TIMEFRAMES.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.segmentedButton}
                aria-pressed={option === timeframe}
                onClick={() => {
                  setHover(undefined);
                  onTimeframe(option);
                }}
              >
                {TIMEFRAME_LABELS[option]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.segmentedButton}
            aria-pressed={zoom}
            title="Zoom the vertical axis to the range the price actually moved in"
            onClick={() => {
              setZoom((value) => !value);
            }}
          >
            Zoom to data
          </button>
        </div>
      </div>
      {points.length === 0 ? (
        <p className={styles.empty}>No price history yet. The desk records a snapshot every 30 seconds while this market is watched, so a chart will appear here soon.</p>
      ) : (
        <div className={styles.chartFrame}>
          <svg
            className={styles.chart}
            viewBox={`0 0 ${String(DEFAULT_BOX.width)} ${String(DEFAULT_BOX.height)}`}
            role="img"
            aria-label={`Odds over time. Latest YES price ${formatPriceCents(points.at(-1)?.cents ?? null)}. Use left and right arrow keys to inspect points.`}
            tabIndex={0}
            onPointerMove={moveTo}
            onPointerLeave={() => {
              setHover(undefined);
            }}
            onKeyDown={keyMove}
          >
            {geometry.yTicks.map((tick) => (
              <g key={tick.value}>
                <line className={styles.gridLine} x1={DEFAULT_BOX.left} x2={DEFAULT_BOX.width - DEFAULT_BOX.right} y1={tick.y} y2={tick.y} />
                <text className={styles.axisText} x={DEFAULT_BOX.left - 6} y={tick.y + 4} textAnchor="end">
                  {tick.value}%
                </text>
              </g>
            ))}
            {geometry.xTicks.map((tick) => (
              <text key={tick.t} className={styles.axisText} x={tick.x} y={DEFAULT_BOX.height - 6} textAnchor="middle">
                {formatAxisTime(tick.t, geometry.spanMs)}
              </text>
            ))}
            {showOverlays && geometry.band !== "" ? <path className={styles.band} d={geometry.band} /> : null}
            {geometry.bars.map((bar) => (
              <rect key={bar.x} className={styles.volumeBar} x={bar.x} y={bar.y} width={bar.width} height={bar.height} />
            ))}
            {points.length === 1 ? null : <path className={styles.priceLine} d={geometry.line} />}
            {showOverlays && geometry.average !== "" ? <path className={styles.averageLine} d={geometry.average} /> : null}
            {points.map((point, index) =>
              points.length <= 60 || index === points.length - 1 ? (
                <circle key={point.t} className={point.source === "gemini" ? styles.dotGemini : styles.dotSnapshot} cx={geometry.xs[index]} cy={geometry.ys[index]} r={2.5} />
              ) : null,
            )}
            {hoverX !== undefined && hoverY !== undefined ? (
              <g pointerEvents="none">
                <line className={styles.crosshair} x1={hoverX} x2={hoverX} y1={geometry.plotTop} y2={DEFAULT_BOX.height - DEFAULT_BOX.axisBottom} />
                <circle className={styles.hoverDot} cx={hoverX} cy={hoverY} r={5} />
              </g>
            ) : null}
          </svg>
          {hovered && hoverX !== undefined ? (
            <div className={styles.hoverCard} style={{ left: `${String(Math.min(78, Math.max(2, (hoverX / DEFAULT_BOX.width) * 100 - 8)))}%` }} role="status">
              <span className={styles.hoverTime}>{formatFullTime(hovered.t)}</span>
              <span className={styles.hoverPrice}>{formatPriceCents(hovered.cents)} YES</span>
              {hovered.bidCents !== null || hovered.askCents !== null ? (
                <span>
                  bid {formatPriceCents(hovered.bidCents)} · ask {formatPriceCents(hovered.askCents)}
                </span>
              ) : null}
              <span>volume {hovered.volume === null ? "n/a" : formatVolume(hovered.volume)}</span>
              <span>from {SOURCE_LABELS[hovered.source]}</span>
            </div>
          ) : null}
        </div>
      )}
      <ul className={styles.legend} aria-label="Chart legend">
        {sources.map((source) => (
          <li key={source} className={styles.legendItem} data-source={source}>
            <span className={styles.legendSwatch} aria-hidden="true" />
            {SOURCE_LABELS[source]}
          </li>
        ))}
        <li className={styles.legendItem} data-kind="volume">
          <span className={styles.legendSwatch} aria-hidden="true" />
          Volume
        </li>
        {showOverlays ? (
          <>
            <li className={styles.legendItem} data-kind="average">
              <span className={styles.legendSwatch} aria-hidden="true" />
              <Tip text="Average of the last 20 points.">Moving average</Tip>
            </li>
            <li className={styles.legendItem} data-kind="band">
              <span className={styles.legendSwatch} aria-hidden="true" />
              <Tip text="The usual range: average ± 2 standard deviations. Prices outside it are unusual.">Bollinger band</Tip>
            </li>
          </>
        ) : null}
      </ul>
    </section>
  );
}
