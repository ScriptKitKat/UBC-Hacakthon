"use client";

import Link from "next/link";
import { useState } from "react";
import type { PositionStatus, PositionView, PositionsView } from "@/shared";
import { AppBar } from "../_desk/app-bar";
import { formatClock, shortenMiddle } from "../_desk/format";
import { usePolling } from "../_desk/use-polling";
import { formatDollarsFromCents, formatPercent, formatPriceCents } from "../_research/format";
import { loadPositions } from "./api";
import type { PositionsResult } from "./api";
import styles from "./positions.module.css";

const POLL_INTERVAL_MS = 10_000;

const STATUS_LABELS: Record<PositionStatus, string> = {
  open: "Open",
  closed: "Market closed",
  settled: "Settled",
  unavailable: "Price unavailable",
};

function pnlTone(value: number | null): "up" | "down" | "flat" {
  if (value === null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function Pnl({ cents, percent }: { readonly cents: number | null; readonly percent: number | null }) {
  if (cents === null) return <span className={styles.muted}>n/a</span>;
  return (
    <span className={styles.pnl} data-tone={pnlTone(cents)}>
      {cents > 0 ? "+" : ""}
      {formatDollarsFromCents(cents)}
      {percent === null ? "" : ` (${percent > 0 ? "+" : ""}${formatPercent(percent)})`}
    </span>
  );
}

function PositionRows({ position }: { readonly position: PositionView }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `fills-${position.symbol}-${position.outcome}`;
  return (
    <>
      <tr className={styles.row}>
        <td className={styles.marketCell}>
          <Link className={styles.marketLink} href={`/markets/${position.symbol}`}>
            {position.eventTitle ?? position.symbol}
          </Link>
          <span className={styles.contractName}>{position.contractLabel ?? position.symbol}</span>
        </td>
        <td>
          <span className={position.outcome === "yes" ? styles.pillYes : styles.pillNo}>{position.outcome.toUpperCase()}</span>
        </td>
        <td className={styles.num}>{position.contracts}</td>
        <td className={styles.num}>{formatPriceCents(position.averageEntryCents)}</td>
        <td className={styles.num}>{formatDollarsFromCents(position.costCents)}</td>
        <td className={styles.num}>{formatPriceCents(position.currentCents)}</td>
        <td className={styles.num}>{position.valueCents === null ? "n/a" : formatDollarsFromCents(position.valueCents)}</td>
        <td className={styles.num}>
          <Pnl cents={position.pnlCents} percent={position.pnlPercent} />
        </td>
        <td>
          <span className={styles.status} data-status={position.status}>{STATUS_LABELS[position.status]}</span>
        </td>
        <td>
          <button
            type="button"
            className={styles.expand}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            {position.fills.length} {position.fills.length === 1 ? "payment" : "payments"} {expanded ? "▴" : "▾"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.fillsRow} id={panelId}>
          <td colSpan={10}>
            <ul className={styles.fills}>
              {position.fills.map((fill) => (
                <li key={fill.entryId} className={styles.fill}>
                  <span className={styles.muted}>{formatClock(fill.at)}</span>
                  <span>{fill.contracts} contracts @ {formatPriceCents(fill.priceCents)}</span>
                  <span>{formatDollarsFromCents(fill.costCents)}</span>
                  {fill.explorerUrl !== null && fill.signature !== null ? (
                    <a className={styles.explorerLink} href={fill.explorerUrl} target="_blank" rel="noopener noreferrer" title={fill.signature}>
                      View on Solana Explorer ↗ <span className={styles.signature}>{shortenMiddle(fill.signature, 8, 6)}</span>
                    </a>
                  ) : (
                    <span className={styles.muted}>No explorer link recorded</span>
                  )}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PositionsTable({ view }: { readonly view: PositionsView }) {
  const { totals } = view;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Side</th>
            <th scope="col" className={styles.num}>Contracts</th>
            <th scope="col" className={styles.num}>Avg entry</th>
            <th scope="col" className={styles.num}>Cost</th>
            <th scope="col" className={styles.num}>Now</th>
            <th scope="col" className={styles.num}>Value</th>
            <th scope="col" className={styles.num}>Unrealized P&amp;L</th>
            <th scope="col">Status</th>
            <th scope="col"><span className={styles.visuallyHidden}>Payments</span></th>
          </tr>
        </thead>
        <tbody>
          {view.positions.map((position) => (
            <PositionRows key={`${position.symbol}|${position.outcome}`} position={position} />
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.totals}>
            <th scope="row" colSpan={4}>Total</th>
            <td className={styles.num}>{formatDollarsFromCents(totals.costCents)}</td>
            <td />
            <td className={styles.num}>{formatDollarsFromCents(totals.valueCents)}</td>
            <td className={styles.num}>
              <Pnl cents={totals.pricedCostCents === 0 ? null : totals.pnlCents} percent={totals.pnlPercent} />
            </td>
            <td colSpan={2}>
              {totals.unpricedPositions > 0 ? <span className={styles.muted}>{totals.unpricedPositions} without a live price</span> : null}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function PositionsPage() {
  const [result, setResult] = useState<PositionsResult | null>(null);
  usePolling(() => {
    void loadPositions().then(setResult);
  }, POLL_INTERVAL_MS);
  return (
    <div className={styles.page}>
      <AppBar state={null} />
      <section className={styles.panel} aria-labelledby="positions-heading">
        <h1 id="positions-heading" className={styles.panelTitle}>Positions</h1>
        {result === null ? <p className={styles.muted}>Loading positions…</p> : null}
        {result?.kind === "not-configured" ? <p className={styles.warning}>The desk is not configured, so there are no positions to show.</p> : null}
        {result?.kind === "error" ? <p className={styles.warning} role="alert">{result.message}</p> : null}
        {result?.kind === "ready" && result.view.positions.length === 0 ? (
          <p className={styles.muted}>No filled trades yet. Positions appear here after the desk fills a buy.</p>
        ) : null}
        {result?.kind === "ready" && result.view.positions.length > 0 ? <PositionsTable view={result.view} /> : null}
        <p className={styles.note}>Value uses the price you could sell at today. Paper tickets: no real Gemini order is placed.</p>
      </section>
    </div>
  );
}
