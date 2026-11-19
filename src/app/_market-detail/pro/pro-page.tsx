"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PRO_TIMEFRAMES } from "@/shared";
import type { ProBudget, ProChart, ProIndicatorRow, ProLadderRung, ProLive, ProMarket, ProPosition, ProShell, ProSpot, ProStat, ProTimeframe } from "@/shared";
import { usePolling } from "../../_desk/use-polling";
import { useViewMode } from "../../_research/use-view-mode";
import { StarButton } from "../../_watchlist/star-button";
import { useWatchlist } from "../../_watchlist/use-watchlist";
import { loadProLive, loadProShell } from "./api";
import { CandleChart } from "./candle-chart";
import {
  formatCents,
  formatClock,
  formatDollars,
  formatFeedTime,
  formatPercentMove,
  formatShares,
  formatSignedCents,
  formatSpot,
  formatUsdCompact,
  statClass,
} from "./format";
import { OrderTicket } from "./order-ticket";
import { Tip } from "./tip";
import styles from "./pro.module.css";

const LIVE_MS = 8_000;
const SHELL_MS = 15_000;

function problemMessage(kind: "unknown" | "unavailable" | "error", message?: string): string {
  if (kind === "unknown") return "We couldn't find this market on Gemini. It may have been removed or the link may be wrong.";
  if (kind === "unavailable") return "Gemini isn't responding right now. Try again in a few minutes.";
  return message ?? "Couldn't refresh this page. Trying again shortly.";
}

function StatCell({ label, stat }: { readonly label: string; readonly stat: ProStat }) {
  const text = stat.kind === "value" ? stat.text : "—";
  const tip = stat.kind === "unavailable" ? stat.reason : undefined;
  const value = <div className={[styles.statValue, styles[statClass(stat)]].join(" ")}>{text}</div>;
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      {tip === undefined ? value : <Tip text={tip}>{value}</Tip>}
    </div>
  );
}

function Skeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={index === 0 ? [styles.bone, styles.boneLg].join(" ") : (styles.bone ?? "")} />
      ))}
    </div>
  );
}

function Header({
  market,
  watched,
  onToggle,
}: {
  readonly market: ProMarket;
  readonly watched: boolean;
  readonly onToggle: () => void;
}) {
  const [mode, setMode] = useViewMode();
  const letter = (market.asset ?? market.displayTitle).slice(0, 1);
  const category = market.subcategory !== null && market.subcategory !== "" ? market.subcategory : market.category;
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.icon} style={{ background: market.iconBackground }} aria-hidden="true">{letter}</div>
        <div className={styles.titles}>
          <h1 className={styles.title}>{market.displayTitle}</h1>
          <p className={styles.subtitle}>{market.eventTicker} · {category} · {market.contractLabel || "YES contract"}</p>
        </div>
      </div>
      <div className={styles.grow} />
      <div className={styles.mode} role="group" aria-label="Mode">
        <button type="button" className={styles.modeButton} aria-pressed={mode === "beginner"} onClick={() => { setMode("beginner"); }}>Beginner</button>
        <button type="button" className={styles.modeButton} aria-pressed={mode === "pro"} onClick={() => { setMode("pro"); }}>Pro</button>
      </div>
      <StarButton pressed={watched} onToggle={onToggle} />
    </header>
  );
}

function SpotPanel({ spot }: { readonly spot: ProSpot }) {
  return (
    <section className={styles.panel} aria-labelledby="spot-heading">
      <div className={styles.panelHead}>
        <h2 id="spot-heading" className={styles.panelTitle}>Spot vs strike</h2>
      </div>
      <div className={styles.spotGrid}>
        <div>
          <div className={styles.spotLabel}>{spot.asset} spot</div>
          <div className={styles.spotValue}>{formatSpot(spot.last)}</div>
        </div>
        <div>
          <div className={styles.spotLabel}>Move needed</div>
          <div className={styles.spotValue}>{spot.moveNeeded === null ? "—" : formatPercentMove(spot.moveNeeded)}</div>
        </div>
      </div>
    </section>
  );
}

function LadderPanel({ ladder }: { readonly ladder: readonly ProLadderRung[] }) {
  if (ladder.length === 0) return null;
  const max = Math.max(...ladder.map((rung) => rung.yesCents ?? 0), 1);
  return (
    <section className={styles.panel} aria-labelledby="ladder-heading">
      <div className={styles.panelHead}>
        <h2 id="ladder-heading" className={styles.panelTitle}>Strike ladder</h2>
        <div className={styles.panelMeta}>YES price by strike</div>
      </div>
      <div className={styles.ladder}>
        {ladder.map((rung) => (
          <Link key={rung.symbol} href={rung.href} className={styles.ladderRow} data-current={rung.current ? "true" : "false"}>
            <span>{rung.strikeLabel}</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} style={{ width: `${String(Math.round(((rung.yesCents ?? 0) / max) * 100))}%` }} />
            </span>
            <span>{rung.yesCents === null ? "—" : `${formatCents(rung.yesCents).replace("¢", "")}¢`}</span>
            <span className={rung.changeCents === null ? styles.muted : rung.changeCents > 0 ? styles.up : rung.changeCents < 0 ? styles.down : styles.muted}>
              {rung.changeCents === null ? "" : formatSignedCents(rung.changeCents)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function IndicatorsPanel({ rows }: { readonly rows: readonly ProIndicatorRow[] }) {
  return (
    <section className={styles.panel} aria-labelledby="indicators-heading">
      <h2 id="indicators-heading" className={styles.panelTitle}>Indicators</h2>
      <table className={styles.table}>
        <thead>
          <tr><th>Indicator</th><th>Value</th><th>Signal</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = row.value ?? "—";
            const signal = row.signal ?? "—";
            const tone = row.tone === "up" ? styles.up : row.tone === "down" ? styles.down : row.tone === "warn" ? styles.warn : undefined;
            const cell = (text: string) => row.missing === null ? text : <Tip text={row.missing}>{text}</Tip>;
            return (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className={tone}>{cell(value)}</td>
                <td className={tone}>{cell(signal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function FlowPanel({ live }: { readonly live: ProLive }) {
  const flow = live.flow;
  if (flow === null) {
    return (
      <section className={styles.panel} aria-labelledby="flow-heading">
        <h2 id="flow-heading" className={styles.panelTitle}>Flow · recent prints</h2>
        <p className={styles.empty}>No recent trades from Gemini yet.</p>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-labelledby="flow-heading">
      <h2 id="flow-heading" className={styles.panelTitle}>Flow · recent prints</h2>
      <div className={styles.flowMeta}>
        <span>Bought {flow.buyPercent === null ? "—" : `${String(flow.buyPercent)}%`}</span>
        <span>Sold {flow.sellPercent === null ? "—" : `${String(flow.sellPercent)}%`}</span>
      </div>
      <div className={styles.flowBars} aria-hidden="true">
        <div className={styles.flowYes} style={{ width: `${String(flow.buyPercent ?? 0)}%` }} />
        <div className={styles.flowNo} style={{ width: `${String(flow.sellPercent ?? 0)}%` }} />
      </div>
      <p className={styles.note}>{flow.windowLabel} ({String(flow.sampleSize)} prints). Bought and sold refer to this contract, not a separate NO book. Holder and mention stats are hidden because Gemini does not publish them.</p>
      <dl className={styles.flowGrid}>
        <div>
          <dt>Large trades (&gt;$1k)</dt>
          <dd>
            {flow.largeTradeCount === null
              ? "—"
              : `${String(flow.largeTradeCount)}${flow.largeTradeNetNotional === null ? "" : ` · net ${formatUsdCompact(flow.largeTradeNetNotional)}`}`}
          </dd>
        </div>
        <div>
          <dt>Avg trade size</dt>
          <dd>{flow.averageTradeNotional === null ? "—" : formatUsdCompact(flow.averageTradeNotional)}</dd>
        </div>
      </dl>
    </section>
  );
}

function EventFeed({ live, nowMs }: { readonly live: ProLive; readonly nowMs: number }) {
  return (
    <section className={styles.panel} aria-labelledby="feed-heading">
      <h2 id="feed-heading" className={styles.panelTitle}>Event feed</h2>
      {live.feed.length === 0 ? (
        <p className={styles.empty}>No matched posts or desk trades for this market yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr><th>Time</th><th>Source</th><th>Event</th><th>Odds 1h after</th></tr>
          </thead>
          <tbody>
            {live.feed.map((item) => (
              <tr key={item.id}>
                <td>{formatFeedTime(item.timeMs, nowMs)}</td>
                <td>{item.source}</td>
                <td>
                  {item.url === null ? item.event : <a className={styles.link} href={item.url} rel="noreferrer" target="_blank">{item.event}</a>}
                </td>
                <td className={item.oddsChangeCents === null ? styles.muted : item.oddsChangeCents > 0 ? styles.up : item.oddsChangeCents < 0 ? styles.down : undefined}>
                  {item.oddsChangeCents === null ? "—" : formatSignedCents(item.oddsChangeCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PositionCard({ position }: { readonly position: ProPosition }) {
  return (
    <section className={styles.position} aria-labelledby="position-heading">
      <h2 id="position-heading" className={styles.railTitle}>Your position</h2>
      <dl className={styles.facts}>
        <dt>{position.outcome.toUpperCase()} shares</dt>
        <dd>{position.contracts.toFixed(2)}</dd>
        <dt>Avg entry</dt>
        <dd>{formatCents(position.averageEntryCents)}</dd>
        <dt>Mark (bid)</dt>
        <dd>{position.markCents === null ? "no bid" : formatCents(position.markCents)}</dd>
        <dt>Unrealized P/L</dt>
        <dd className={position.pnlCents === null ? undefined : position.pnlCents >= 0 ? styles.up : styles.down}>
          {position.pnlCents === null
            ? "—"
            : `${formatDollars(position.pnlCents, true)}${position.pnlPercent === null ? "" : ` (${formatSignedCents(position.pnlPercent)}%)`}`}
        </dd>
        <dt>If YES / if NO</dt>
        <dd>{formatDollars(position.ifYesCents, true)} / {formatDollars(position.ifNoCents, true)}</dd>
      </dl>
    </section>
  );
}

function OrderBookCard({ live }: { readonly live: ProLive }) {
  const { book } = live;
  const max = Math.max(1, ...book.asks.map((level) => level.amount), ...book.bids.map((level) => level.amount));
  if (book.source === "unavailable") {
    return (
      <section className={styles.book} aria-labelledby="book-heading">
        <h2 id="book-heading" className={styles.railTitle}>Order book · YES</h2>
        <p className={styles.empty}>Gemini has no live order book for this contract right now.</p>
      </section>
    );
  }
  return (
    <section className={styles.book} aria-labelledby="book-heading">
      <h2 id="book-heading" className={styles.railTitle}>Order book · YES</h2>
      <p className={styles.bookMeta}>
        mid {book.midCents === null ? "—" : formatCents(book.midCents)} · spread {book.spreadCents === null ? "—" : formatCents(book.spreadCents)}
      </p>
      <table className={styles.bookTable}>
        <thead>
          <tr><th>Price</th><th>Shares</th><th>Total</th></tr>
        </thead>
        <tbody>
          {[...book.asks].reverse().map((level) => (
            <tr key={`a-${String(level.priceCents)}`} className={styles.ask}>
              <td>{formatCents(level.priceCents)}</td>
              <td>{formatShares(level.amount)}</td>
              <td>
                <span className={[styles.depth, styles.askDepth].join(" ")} style={{ width: `${String(Math.round((level.amount / max) * 100))}%` }} />
                {formatUsdCompact(level.cumulative)}
              </td>
            </tr>
          ))}
          <tr className={styles.spreadRow}><td colSpan={3}>{book.spreadCents === null ? "—" : `▲ ${formatCents(book.spreadCents).replace("¢", "")}`}</td></tr>
          {book.bids.map((level) => (
            <tr key={`b-${String(level.priceCents)}`} className={styles.bid}>
              <td>{formatCents(level.priceCents)}</td>
              <td>{formatShares(level.amount)}</td>
              <td>
                <span className={[styles.depth, styles.bidDepth].join(" ")} style={{ width: `${String(Math.round((level.amount / max) * 100))}%` }} />
                {formatUsdCompact(level.cumulative)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.slip}>
        Slippage for $500 market buy: {book.slippage500Cents === null ? "Not enough depth to fill $500." : `+${formatCents(book.slippage500Cents).replace("¢", "")}¢`}
      </p>
    </section>
  );
}

function TradesCard({ live }: { readonly live: ProLive }) {
  if (live.trades.source === "unavailable") {
    return (
      <section className={styles.tape} aria-labelledby="tape-heading">
        <h2 id="tape-heading" className={styles.railTitle}>Recent trades</h2>
        <p className={styles.empty}>Gemini has no recent trades for this contract right now.</p>
      </section>
    );
  }
  return (
    <section className={styles.tape} aria-labelledby="tape-heading">
      <h2 id="tape-heading" className={styles.railTitle}>Recent trades</h2>
      {live.trades.items.length === 0 ? (
        <p className={styles.empty}>No recent prints.</p>
      ) : (
        <table className={styles.tapeTable}>
          <thead>
            <tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th></tr>
          </thead>
          <tbody>
            {live.trades.items.map((trade) => (
              <tr key={trade.tradeId}>
                <td>{formatClock(trade.timeMs)}</td>
                <td className={trade.side === "buy" ? styles.up : styles.down}>{trade.side === "buy" ? "BUY" : "SELL"}</td>
                <td>{formatCents(trade.priceCents)}</td>
                <td>{formatShares(trade.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ProPage({ symbol, initial }: { readonly symbol: string; readonly initial?: ProShell }) {
  const [timeframe, setTimeframe] = useState<ProTimeframe | undefined>(initial?.chart.timeframe);
  const [shell, setShell] = useState<ProShell | undefined>(initial);
  const [live, setLive] = useState<ProLive | undefined>(undefined);
  const [problem, setProblem] = useState<"unknown" | "unavailable" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const wanted = useRef<ProTimeframe | undefined>(initial?.chart.timeframe);
  const watchlist = useWatchlist(initial?.watched ? [symbol, initial.market.eventTicker] : []);

  const refreshShell = () => {
    const requested = wanted.current;
    void loadProShell(symbol, requested).then((result) => {
      if (requested !== wanted.current) return;
      if (result.kind === "ready") {
        setShell(result.shell);
        if (wanted.current === undefined) {
          wanted.current = result.shell.chart.timeframe;
          setTimeframe(result.shell.chart.timeframe);
        }
        setProblem(null);
        return;
      }
      if (result.kind === "unknown") {
        setShell(undefined);
        setProblem("unknown");
        return;
      }
      setProblem(result.kind);
      setErrorMessage(result.kind === "error" ? result.message : undefined);
    });
  };

  const refreshLive = () => {
    const requested = wanted.current;
    void loadProLive(symbol, requested).then((result) => {
      if (requested !== wanted.current) return;
      if (result.kind === "ready") {
        setLive(result.live);
        return;
      }
      if (shell !== undefined) return;
      if (result.kind === "unknown") setProblem("unknown");
      else {
        setProblem(result.kind);
        setErrorMessage(result.kind === "error" ? result.message : undefined);
      }
    });
  };

  usePolling(refreshShell, SHELL_MS);
  usePolling(refreshLive, LIVE_MS);

  const chooseTimeframe = (next: ProTimeframe) => {
    if (!(PRO_TIMEFRAMES as readonly string[]).includes(next)) return;
    wanted.current = next;
    setTimeframe(next);
    refreshShell();
  };

  const market = shell?.market;
  const budget: ProBudget | undefined = live?.budget ?? shell?.budget;
  const position: ProPosition | null | undefined = live?.position ?? shell?.position;
  const chart: ProChart | undefined = shell?.chart;
  const spot: ProSpot | null | undefined = shell?.spot;
  const watched = market === undefined ? false : watchlist.starred(market.eventTicker, market.symbol);
  const nowMs = Date.parse(live?.generatedAt ?? shell?.generatedAt ?? new Date().toISOString());
  const spotLabel = spot === undefined || spot === null ? null : `— ${spot.asset} spot ${formatSpot(spot.last)}`;

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        {market !== undefined ? (
          <Header
            market={market}
            watched={watched}
            onToggle={() => {
              void watchlist.toggle({ eventTicker: market.eventTicker, instrumentSymbol: market.symbol, yesCents: market.yesAskCents });
            }}
          />
        ) : null}
        {problem !== null ? <p className={styles.banner} role="alert">{problemMessage(problem, errorMessage)}</p> : null}
        {shell === undefined && problem === null ? <p className={styles.status}>Loading live market…</p> : null}
        {shell !== undefined ? (
          <>
            <div className={styles.stats}>
              <StatCell label="Last" stat={shell.stats.last} />
              <StatCell label="24h change" stat={shell.stats.change24h} />
              <StatCell label="Bid / ask" stat={shell.stats.bidAsk} />
              <StatCell label="24h high / low" stat={shell.stats.highLow24h} />
              <StatCell label="24h volume" stat={shell.stats.volume24h} />
              <StatCell label="Total volume" stat={shell.stats.volumeTotal} />
              <StatCell label="Open interest" stat={shell.stats.openInterest} />
              <StatCell label="Traders" stat={shell.stats.traders} />
              <StatCell label="Resolves in" stat={shell.stats.resolvesIn} />
              <StatCell label="Max payout" stat={shell.stats.maxPayout} />
            </div>
            <div className={styles.body}>
              {chart !== undefined ? (
                <CandleChart chart={timeframe === undefined || chart.timeframe === timeframe ? chart : { ...chart, timeframe }} timeframe={timeframe ?? chart.timeframe} onTimeframe={chooseTimeframe} spotLabel={spotLabel} />
              ) : null}
              {spot !== null && spot !== undefined ? <SpotPanel spot={spot} /> : null}
              <LadderPanel ladder={shell.ladder} />
              {live === undefined ? (
                <section className={styles.panel} aria-label="Loading indicators">
                  <Skeleton rows={5} />
                </section>
              ) : (
                <IndicatorsPanel rows={live.indicators} />
              )}
              {live === undefined ? (
                <section className={styles.panel} aria-label="Loading flow">
                  <Skeleton />
                </section>
              ) : (
                <FlowPanel live={live} />
              )}
              {live === undefined ? (
                <section className={styles.panel} aria-label="Loading event feed">
                  <Skeleton />
                </section>
              ) : (
                <EventFeed live={live} nowMs={nowMs} />
              )}
            </div>
          </>
        ) : null}
      </div>
      <aside className={styles.rail}>
        {market !== undefined && budget !== undefined ? <OrderTicket market={market} budget={budget} /> : <div className={styles.ticket}><Skeleton rows={8} /></div>}
        {position !== undefined && position !== null ? <PositionCard position={position} /> : null}
        {live === undefined ? <div className={styles.book}><Skeleton rows={6} /></div> : <OrderBookCard live={live} />}
        {live === undefined ? <div className={styles.tape}><Skeleton rows={6} /></div> : <TradesCard live={live} />}
      </aside>
    </div>
  );
}

