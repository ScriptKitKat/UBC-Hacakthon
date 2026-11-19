import type { ResearchIndicators } from "@/shared";
import { formatPriceCents, formatSignedCents } from "./format";
import { Tip } from "./tip";
import styles from "./research.module.css";

interface Row {
  readonly key: string;
  readonly label: string;
  readonly tip: string;
  readonly value: string;
  readonly reading: string;
  readonly alert: boolean;
}

function rows(indicators: ResearchIndicators): readonly Row[] {
  const { momentum, jumpiness, volumeSpike, averagePrice, recentMove } = indicators;
  return [
    {
      key: "momentum",
      label: "Momentum",
      tip: "Whether recent price changes were mostly up or mostly down, from 0 to 100 (RSI-14).",
      value: momentum.value === null ? "n/a" : `${String(Math.round(momentum.value))} / 100`,
      reading: momentum.reading,
      alert: momentum.zone === "overbought" || momentum.zone === "oversold",
    },
    {
      key: "jumpiness",
      label: "Jumpiness",
      tip: "How much the price swings around its average (standard deviation, with a Bollinger band of ±2).",
      value: jumpiness.value === null ? "n/a" : `±${formatPriceCents(jumpiness.value)}`,
      reading: jumpiness.reading,
      alert: jumpiness.outsideBand,
    },
    {
      key: "volume",
      label: "Volume spike",
      tip: "Trading in the latest hour compared with the usual hour, plus whether volume leans toward rising or falling prices.",
      value: volumeSpike.ratio === null ? "n/a" : `${String(volumeSpike.ratio)}×`,
      reading: volumeSpike.reading,
      alert: volumeSpike.ratio !== null && volumeSpike.ratio >= 2,
    },
    {
      key: "average",
      label: "Average price",
      tip: "The simple moving average of the last 20 hourly prices.",
      value: formatPriceCents(averagePrice.value),
      reading: averagePrice.reading,
      alert: false,
    },
    {
      key: "move",
      label: "Recent move",
      tip: "How far the price has moved in the last hour and in the last day.",
      value: formatSignedCents(recentMove.hourCents ?? recentMove.dayCents),
      reading: recentMove.reading,
      alert: recentMove.hourCents !== null && Math.abs(recentMove.hourCents) >= 5,
    },
  ];
}

export function IndicatorsPanel({ indicators }: { readonly indicators: ResearchIndicators }) {
  return (
    <section className={styles.panel} aria-labelledby="indicators-heading">
      <h2 id="indicators-heading" className={styles.panelTitle}>Indicators</h2>
      <ul className={styles.indicatorList}>
        {rows(indicators).map((row) => (
          <li key={row.key} className={styles.indicator} data-alert={row.alert}>
            <div className={styles.indicatorHead}>
              <Tip text={row.tip}>
                <span className={styles.indicatorLabel}>{row.label}</span>
              </Tip>
              <span className={styles.indicatorValue}>{row.value}</span>
            </div>
            <p className={styles.indicatorReading}>{row.reading}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
