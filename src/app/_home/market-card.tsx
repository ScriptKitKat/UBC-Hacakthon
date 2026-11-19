"use client";

import Link from "next/link";
import {
  buildSparkline,
  changeTrend,
  formatDeadline,
  formatPercent,
  formatSignedPercent,
  friendlyEventTitle,
} from "@/shared";
import type { CatalogCard } from "@/shared";
import styles from "./market-card.module.css";

const CHART_WIDTH = 96;
const CHART_HEIGHT = 32;

export function marketHref(symbol: string): string {
  return `/markets/${encodeURIComponent(symbol)}`;
}

export function changeLabel(card: CatalogCard): string | null {
  return card.changePercent === null ? null : `${formatSignedPercent(card.changePercent)} 24h`;
}

export function MarketCard({
  card,
  watched,
  onToggleWatch,
}: {
  readonly card: CatalogCard;
  readonly watched?: boolean;
  readonly onToggleWatch?: () => void;
}) {
  const title = friendlyEventTitle(card.eventTitle, card.expiryDate);
  const closes = formatDeadline(card.expiryDate) ?? card.endsIn;
  const sparkline = buildSparkline(card.sparkline, CHART_WIDTH, CHART_HEIGHT, 2);
  const label = changeLabel(card);
  const trend = sparkline?.trend ?? changeTrend(card.changePercent);
  const href = marketHref(card.instrumentSymbol);
  return (
    <article className={styles.wrap}>
      <Link href={href} className={styles.card} aria-label={`${title}${card.contractLabel !== "" ? ` · ${card.contractLabel}` : ""}, ${formatPercent(card.yesCents)} Yes`}>
        <div className={styles.head}>
          <div className={styles.titles}>
            <div className={styles.category}>{card.categoryLabel}</div>
            <div className={styles.title}>{title}</div>
            {card.contractLabel !== "" ? <div className={styles.strike}>{card.contractLabel}</div> : null}
            {closes ? <div className={styles.deadline}>{closes}</div> : null}
          </div>
          {sparkline !== undefined ? (
            <div className={styles.chartBlock}>
              <div className={styles.chart}>
                <svg viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`} role="img" aria-label="Yes price history">
                  <path className={styles.area} d={sparkline.area} data-trend={sparkline.trend} />
                  <path className={styles.line} d={sparkline.line} data-trend={sparkline.trend} />
                </svg>
              </div>
              {label !== null ? <div className={styles.change} data-trend={trend}>{label}</div> : null}
            </div>
          ) : label !== null ? (
            <div className={styles.change} data-trend={trend}>{label}</div>
          ) : null}
        </div>
        <div className={styles.odds}>{formatPercent(card.yesCents)}</div>
      </Link>
      {onToggleWatch !== undefined ? (
        <button type="button" className={styles.watch} onClick={onToggleWatch}>
          {watched === true ? "Unwatch" : "Watch"}
        </button>
      ) : null}
    </article>
  );
}
