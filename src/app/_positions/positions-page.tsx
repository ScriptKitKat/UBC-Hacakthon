"use client";

import Link from "next/link";
import { useState } from "react";
import type { PortfolioActivity, PortfolioRange, PortfolioView } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { formatDollarsFromCents, formatPercent, formatPriceCents } from "../_research/format";
import { downloadActivityCsv, loadPortfolio } from "./api";
import type { PortfolioResult } from "./api";
import styles from "./positions.module.css";

const POLL_INTERVAL_MS = 15_000;
const RANGES: readonly PortfolioRange[] = ["7d", "30d", "90d", "all"];
const RANGE_LABEL: Record<PortfolioRange, string> = { "7d": "7D", "30d": "30D", "90d": "90D", all: "All" };

function toneOf(value: number | null): "up" | "down" | "neutral" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

function signedDollars(cents: number): string {
  const formatted = formatDollarsFromCents(cents);
  return cents > 0 ? `+${formatted}` : formatted;
}

function signedPercent(value: number | null): string {
  if (value === null) return "—";
  const formatted = formatPercent(value, value === Math.round(value) ? 0 : 1);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatWhen(iso: string, nowIso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const when = new Date(ms);
  const now = new Date(nowIso);
  const sameDay = when.toLocaleDateString("en-US", { timeZone: "America/Chicago" }) === now.toLocaleDateString("en-US", { timeZone: "America/Chicago" });
  const time = when.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return `Today ${time}`;
  return when.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
}

function formatSince(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
}

function yOf(value: number, min: number, max: number, top: number, bottom: number): number {
  if (max === min) return (top + bottom) / 2;
  return top + ((max - value) / (max - min)) * (bottom - top);
}

function PnlChart({ view }: { readonly view: PortfolioView }) {
  const width = 640;
  const height = 220;
  const left = 36;
  const right = 16;
  const top = 12;
  const bottom = 28;
  const series = view.pnlSeries;
  if (series.length === 0) return <p className={styles.empty}>No P/L history in this range yet.</p>;
  const values = series.flatMap((point) => [point.totalPnlCents, point.researchSpendCents]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const pad = Math.max(50, (max - min) * 0.08);
  const lo = min - pad;
  const hi = max + pad;
  const step = series.length === 1 ? width - left - right : (width - left - right) / (series.length - 1);
  const xOf = (index: number) => left + step * index;
  const line = (key: "totalPnlCents" | "researchSpendCents") =>
    series.map((point, index) => `${index === 0 ? "M" : "L"} ${xOf(index).toFixed(1)} ${yOf(point[key], lo, hi, top, height - bottom).toFixed(1)}`).join(" ");
  const area = `${line("totalPnlCents")} L ${xOf(series.length - 1).toFixed(1)} ${yOf(0, lo, hi, top, height - bottom).toFixed(1)} L ${xOf(0).toFixed(1)} ${yOf(0, lo, hi, top, height - bottom).toFixed(1)} Z`;
  const ticks = [0, Math.floor((series.length - 1) / 3), Math.floor((2 * (series.length - 1)) / 3), series.length - 1]
    .filter((index, position, list) => series[index] !== undefined && list.indexOf(index) === position);
  const yTicks = [hi, 0, lo].filter((value, index, list) => list.indexOf(value) === index);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label="Profit and loss over the selected range">
      <line x1={String(left)} x2={String(width - right)} y1={String(yOf(0, lo, hi, top, height - bottom))} y2={String(yOf(0, lo, hi, top, height - bottom))} stroke="#262626" />
      {yTicks.map((value) => (
        <text key={value} className={styles.chartLabel} x={String(width - 4)} y={String(yOf(value, lo, hi, top, height - bottom) - 4)} textAnchor="end">
          {`${value >= 0 ? "+" : "−"}$${(Math.abs(value) / 100).toFixed(0)}`}
        </text>
      ))}
      <path d={area} fill="rgba(237,237,237,0.06)" />
      <path d={line("totalPnlCents")} fill="none" stroke="#ededed" strokeWidth="1.6" />
      <path d={line("researchSpendCents")} fill="none" stroke="#f5a524" strokeWidth="1.4" strokeDasharray="4 3" />
      {ticks.map((index) => {
        const point = series[index];
        return point === undefined ? null : (
          <text key={point.at} className={styles.chartLabel} x={String(xOf(index))} y={String(height - 8)} textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"}>
            {point.label}
          </text>
        );
      })}
    </svg>
  );
}

function SpendChart({ view }: { readonly view: PortfolioView }) {
  const width = 420;
  const height = 220;
  const left = 10;
  const right = 10;
  const top = 16;
  const bottom = 28;
  const days = view.dailySpend.days;
  if (days.length === 0) return <p className={styles.empty}>No settled spend in this window.</p>;
  const peak = Math.max(view.dailyCapCents, ...days.map((day) => day.betsCents + day.briefsCents), 1);
  const slot = (width - left - right) / days.length;
  const bar = Math.max(4, slot * 0.55);
  const capY = yOf(view.dailyCapCents, 0, peak, top, height - bottom);
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((index, position, list) => days[index] !== undefined && list.indexOf(index) === position);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label="Daily spend versus the desk cap">
      <line x1={String(left)} x2={String(width - right)} y1={String(capY)} y2={String(capY)} stroke="#f5a524" strokeDasharray="4 3" />
      {days.map((day, index) => {
        const x = left + slot * index + (slot - bar) / 2;
        const total = day.betsCents + day.briefsCents;
        const betsH = (day.betsCents / peak) * (height - bottom - top);
        const briefsH = (day.briefsCents / peak) * (height - bottom - top);
        return (
          <g key={day.day}>
            <rect x={x} y={height - bottom - betsH - briefsH} width={bar} height={Math.max(0, briefsH)} fill="#f5a524" />
            <rect x={x} y={height - bottom - betsH} width={bar} height={Math.max(0, betsH)} fill="#3f3f46" />
            <title>{`${day.label}: bets ${formatDollarsFromCents(day.betsCents)}, briefs ${formatDollarsFromCents(day.briefsCents)}, total ${formatDollarsFromCents(total)}`}</title>
          </g>
        );
      })}
      {ticks.map((index) => {
        const day = days[index];
        return day === undefined ? null : (
          <text key={day.day} className={styles.chartLabel} x={String(left + slot * index + slot / 2)} y={String(height - 8)} textAnchor="middle">
            {day.label}
          </text>
        );
      })}
    </svg>
  );
}

function ReceiptDialog({ row, onClose }: { readonly row: PortfolioActivity; readonly onClose: () => void }) {
  return (
    <div className={styles.dialogBack} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="receipt-title"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id="receipt-title">Receipt</h2>
        <dl>
          <dt>Type</dt>
          <dd>{row.type}</dd>
          <dt>Market</dt>
          <dd>{row.market}</dd>
          <dt>When</dt>
          <dd>{row.at}</dd>
          <dt>Amount</dt>
          <dd>{signedDollars(row.amountCents)}</dd>
          {row.ticket !== null ? (
            <>
              <dt>Paper order</dt>
              <dd>
                {row.ticket.ticketId} · {row.ticket.quantity} {row.ticket.outcome.toUpperCase()} at {row.ticket.price} ({row.ticket.mode})
              </dd>
            </>
          ) : (
            <>
              <dt>Paper order</dt>
              <dd>{row.ticketId ?? "Not recorded on this row"}</dd>
            </>
          )}
          <dt>Signature</dt>
          <dd className={styles.mono}>{row.signature ?? "No Solana signature recorded"}</dd>
          <dt>Explorer</dt>
          <dd>
            {row.explorerUrl !== null && row.signature !== null ? (
              <a href={row.explorerUrl} target="_blank" rel="noopener noreferrer">View on Solana Explorer ↗</a>
            ) : "No explorer link recorded"}
          </dd>
        </dl>
        <button type="button" className={styles.dialogClose} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function PositionsPage() {
  const [range, setRange] = useState<PortfolioRange>("30d");
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [filter, setFilter] = useState<"all" | "bets" | "briefs">("all");
  const [receipt, setReceipt] = useState<PortfolioActivity | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  usePolling(() => {
    void loadPortfolio(range).then(setResult);
  }, POLL_INTERVAL_MS, range);
  const view = result?.kind === "ready" ? result.view : null;
  const activity = (view?.activity ?? []).filter((row) => filter === "all" || (filter === "briefs" ? row.type === "brief" : row.type !== "brief"));
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Portfolio</h1>
          <p className={styles.subtitle}>
            {view === null ? "Paid in USDC on Solana" : `Since ${formatSince(view.rangeStart)} · paid in USDC on Solana`}
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.ranges} role="group" aria-label="Range">
            {RANGES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={item === range}
                onClick={() => {
                  setRange(item);
                  setResult(null);
                }}
              >
                {RANGE_LABEL[item]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.export}
            onClick={() => {
              void downloadActivityCsv(range).then((outcome) => {
                setExportError(outcome.kind === "error" ? outcome.message : null);
              });
            }}
          >
            Export CSV
          </button>
        </div>
      </header>
      {exportError !== null ? <p className={styles.warning} role="alert">{exportError}</p> : null}
      {result === null ? <p className={styles.muted}>Loading portfolio…</p> : null}
      {result?.kind === "not-configured" ? <p className={styles.warning}>The desk is not configured, so there is no portfolio to show.</p> : null}
      {result?.kind === "error" ? <p className={styles.warning} role="alert">{result.message}</p> : null}
      {view !== null ? (
        <>
          <section className={styles.stats} aria-label="Portfolio stats">
            <article className={styles.stat}>
              <p className={styles.statLabel}>Total P/L</p>
              <p className={styles.statValue} data-tone={toneOf(view.stats.totalPnl.valueCents)}>{signedDollars(view.stats.totalPnl.valueCents)}</p>
              <p className={styles.statDetail}>{view.stats.totalPnl.detail}</p>
            </article>
            <article className={styles.stat}>
              <p className={styles.statLabel}>Open positions</p>
              <p className={styles.statValue}>{formatDollarsFromCents(view.stats.openValue.valueCents)}</p>
              <p className={styles.statDetail}>{view.stats.openValue.detail}</p>
            </article>
            <article className={styles.stat}>
              <p className={styles.statLabel}>Realized P/L</p>
              <p className={styles.statValue} data-tone={toneOf(view.stats.realizedPnl.valueCents)}>{signedDollars(view.stats.realizedPnl.valueCents)}</p>
              <p className={styles.statDetail}>{view.stats.realizedPnl.detail}</p>
            </article>
            <article className={styles.stat}>
              <p className={styles.statLabel}>Win rate</p>
              <p className={styles.statValue}>{view.stats.winRate.percent === null ? "—" : `${String(view.stats.winRate.percent)}%`}</p>
              <p className={styles.statDetail}>{view.stats.winRate.detail}</p>
            </article>
            <article className={styles.stat}>
              <p className={styles.statLabel}>Return on spend</p>
              <p className={styles.statValue} data-tone={toneOf(view.stats.returnOnSpend.percent)}>{signedPercent(view.stats.returnOnSpend.percent)}</p>
              <p className={styles.statDetail}>{view.stats.returnOnSpend.detail}</p>
            </article>
            <article className={styles.stat}>
              <p className={styles.statLabel}>Research spend</p>
              <p className={styles.statValue} data-tone="amber">{formatDollarsFromCents(view.stats.researchSpend.valueCents)}</p>
              <p className={styles.statDetail}>{view.stats.researchSpend.detail}</p>
            </article>
          </section>
          <div className={styles.charts}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Profit and loss</h2>
                <div className={styles.panelMeta}>
                  <span className={styles.swatch}>Total</span>
                  <span className={styles.swatchLine}>Research spend</span>
                </div>
              </div>
              <PnlChart view={view} />
              {view.marksNote !== null ? <p className={styles.caption}>{view.marksNote}</p> : null}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Daily spend vs cap</h2>
                <p className={styles.panelMeta}>{view.dailySpend.windowLabel}</p>
              </div>
              <SpendChart view={view} />
              <p className={styles.panelMeta} style={{ marginTop: 8 }}>
                <span className={styles.swatch}>Bets</span>
                <span className={styles.swatch} style={{ color: "var(--amber)" }}>Briefs</span>
                <span className={styles.swatchLine}>${(view.dailyCapCents / 100).toFixed(0)} cap</span>
              </p>
              <p className={styles.caption}>{view.dailySpend.caption}. Days reset at 6:00 PM CST.</p>
            </section>
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Open positions</h2>
              <p className={styles.panelMeta}>
                {view.openPositions.openCount} open · worth {formatDollarsFromCents(view.openPositions.valueCents)} at current bids
                {view.openPositions.unpriced > 0 ? ` · ${String(view.openPositions.unpriced)} without a bid` : ""}
              </p>
            </div>
            {view.openPositions.rows.length === 0 ? (
              <p className={styles.empty}>No open positions. Filled paper buys appear here with the live Gemini bid.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Market</th>
                      <th scope="col">Side</th>
                      <th scope="col">Placed by</th>
                      <th scope="col" className={styles.num}>Shares</th>
                      <th scope="col" className={styles.num}>Avg</th>
                      <th scope="col" className={styles.num}>Now</th>
                      <th scope="col" className={styles.num}>Value</th>
                      <th scope="col" className={styles.num}>P/L</th>
                      <th scope="col" className={styles.num}>If right</th>
                      <th scope="col">Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.openPositions.rows.map((row) => (
                      <tr key={`${row.symbol}|${row.outcome}`}>
                        <td>
                          <Link href={`/markets/${row.symbol}`}>{row.eventTitle}</Link>
                        </td>
                        <td><span className={row.outcome === "yes" ? styles.pillYes : styles.pillNo}>{row.outcome.toUpperCase()}</span></td>
                        <td>{row.placedBy}</td>
                        <td className={styles.num}>{row.shares.toFixed(2)}</td>
                        <td className={styles.num}>{formatPriceCents(row.averageEntryCents)}</td>
                        <td className={styles.num}>{row.markCents === null ? "no bid" : formatPriceCents(row.markCents)}</td>
                        <td className={styles.num}>{row.valueCents === null ? "no bid" : formatDollarsFromCents(row.valueCents)}</td>
                        <td className={styles.num}>
                          {row.pnlCents === null ? "n/a" : <span className={styles.pnl} data-tone={toneOf(row.pnlCents)}>{signedDollars(row.pnlCents)}</span>}
                        </td>
                        <td className={styles.num}>{formatDollarsFromCents(row.ifRightCents)}</td>
                        <td>{row.ends ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className={styles.split}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>By category</h2>
              </div>
              {view.categories.rows.length === 0 ? (
                <p className={styles.empty}>No category P/L yet.</p>
              ) : (
                <div className={styles.categoryRows}>
                  {view.categories.rows.map((row) => {
                    const max = Math.max(...view.categories.rows.map((item) => Math.abs(item.pnlCents)), 1);
                    return (
                      <div key={row.category} className={styles.categoryRow}>
                        <span>{row.category}</span>
                        <div className={styles.track}>
                          <div className={styles.fill} data-tone={toneOf(row.pnlCents)} style={{ width: `${String((Math.abs(row.pnlCents) / max) * 100)}%` }} />
                        </div>
                        <span className={styles.pnl} data-tone={toneOf(row.pnlCents)}>{signedDollars(row.pnlCents)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {view.categories.caption !== null ? <p className={styles.caption}>{view.categories.caption}</p> : null}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>How well you price odds</h2>
                <p className={styles.panelMeta}>{view.calibration.settledBets} settled bets</p>
              </div>
              {view.calibration.empty !== null ? (
                <p className={styles.empty}>{view.calibration.empty}</p>
              ) : (
                <div className={styles.calRows}>
                  {view.calibration.buckets.map((bucket) => (
                    <div key={bucket.label} className={styles.calRow}>
                      <span>{bucket.label}</span>
                      <div className={styles.calTrack}>
                        <div className={styles.calFill} style={{ width: `${String(Math.min(100, bucket.winRatePercent))}%` }} />
                        <span className={styles.calTick} style={{ left: `${String(Math.min(100, bucket.impliedPercent))}%` }} />
                      </div>
                      <span className={styles.muted}>won {String(bucket.winRatePercent)}%</span>
                    </div>
                  ))}
                  <p className={styles.caption}>The white tick is what the price implied. Blue past the tick means those bets won more often than the price said.</p>
                </div>
              )}
            </section>
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>All activity</h2>
              <div className={styles.ranges} role="group" aria-label="Activity filter">
                {([
                  ["all", "All"],
                  ["bets", "Bets"],
                  ["briefs", "Briefs"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); }}>{label}</button>
                ))}
              </div>
            </div>
            {activity.length === 0 ? (
              <p className={styles.empty}>No activity in this range.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Type</th>
                      <th scope="col">Market</th>
                      <th scope="col">By</th>
                      <th scope="col">Detail</th>
                      <th scope="col" className={styles.num}>Amount</th>
                      <th scope="col">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((row) => (
                      <tr key={row.id}>
                        <td>{formatWhen(row.at, view.generatedAt)}</td>
                        <td>
                          <span className={row.type === "brief" ? styles.typeBrief : row.type === "payout" ? styles.typePayout : styles.typeBet}>
                            {row.type === "brief" ? "Brief" : row.type === "payout" ? "Payout" : "Bet"}
                          </span>
                        </td>
                        <td><Link href={`/markets/${row.symbol}`}>{row.market}</Link></td>
                        <td>{row.placedBy}</td>
                        <td>{row.detail}</td>
                        <td className={styles.num}>
                          <span className={styles.pnl} data-tone={toneOf(row.amountCents)}>{signedDollars(row.amountCents)}</span>
                        </td>
                        <td>
                          <button type="button" className={styles.receipt} onClick={() => { setReceipt(row); }}>View ↗</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {receipt !== null ? <ReceiptDialog row={receipt} onClose={() => { setReceipt(null); }} /> : null}
    </div>
  );
}
