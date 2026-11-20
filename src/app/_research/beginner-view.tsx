"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BEGINNER_TIMEFRAMES,
  briefStaleCopy,
  crowdMoves,
  crowdSentence,
  dayChangeCents,
  driversFromBrief,
  formatPercent,
  historySourceLabel,
  isBeginnerTimeframe,
  marketTitle,
  parseResolution,
  trustOdds,
  yesCentsFromBrief,
} from "@/shared";
import type { CrowdMove, ResearchBrief, ResearchTimeframe, ResearchView } from "@/shared";
import { MarketHeader, marketHeaderModel } from "../_market-detail/market-header";
import { useWatchlist } from "../_watchlist/use-watchlist";
import { usePolling } from "../_desk/use-polling";
import { formatAxisTime } from "./format";
import { DEFAULT_BOX, buildChartGeometry } from "./chart-geometry";
import { loadResearchBriefs, purchaseDeepDive } from "./api";
import type { StoredBrief } from "./api";
import { TradeCard } from "./trade-card";
import styles from "./beginner.module.css";

const WATCH_MS = 15_000;
const CHART_BOX = { ...DEFAULT_BOX, height: 280, volumeHeight: 40, top: 16 };

function signedPoints(delta: number): string {
  const points = Math.round(Math.abs(delta));
  return `${delta >= 0 ? "▲" : "▼"} ${String(points)}`;
}

function relativeTime(atMs: number, nowMs: number): string {
  const delta = nowMs - atMs;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${String(Math.max(1, Math.round(delta / 60_000)))}m`;
  if (delta < 24 * 3_600_000) return `${String(Math.max(1, Math.round(delta / 3_600_000)))}h`;
  return `${String(Math.max(1, Math.round(delta / (24 * 3_600_000))))}d`;
}

function isSafeHttpUrl(url: string): boolean {
  const parsed = URL.parse(url);
  return parsed !== null && parsed.protocol === "https:";
}

export function BeginnerView({
  view,
  timeframe,
  onTimeframe,
  banners,
}: {
  readonly view: ResearchView;
  readonly timeframe: ResearchTimeframe;
  readonly onTimeframe: (timeframe: ResearchTimeframe) => void;
  readonly banners: readonly string[];
}) {
  const watchlist = useWatchlist();
  const title = marketTitle(view);
  const nowMs = Date.parse(view.generatedAt);
  const change = dayChangeCents(view);
  const sentence = crowdSentence(view, Number.isFinite(nowMs) ? new Date(nowMs) : new Date());
  const resolution = parseResolution(view.market.rulesText, view.market.termsLink);
  const trust = trustOdds(view);
  const moves = crowdMoves(view.series.points, view.matchedPosts);
  const [activeMove, setActiveMove] = useState<number>(moves.length);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  usePolling(() => {
    void loadResearchBriefs(view.symbol).then((result) => {
      if (result.kind === "ready") setBrief(result.current?.brief ?? null);
    });
  }, WATCH_MS);
  const drivers = driversFromBrief(brief);
  const selected = moves[activeMove - 1] ?? moves.at(-1);
  return (
    <div className={styles.page}>
      <MarketHeader
        model={marketHeaderModel({ category: view.market.category, title, imageUrl: view.market.imageUrl, expiryDate: view.market.expiryDate, volume: view.market.volume, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() })}
        watched={watchlist.starred(view.market.eventTicker, view.symbol)}
        onToggleWatch={() => {
          void watchlist.toggle({ eventTicker: view.market.eventTicker, instrumentSymbol: view.symbol, yesCents: view.market.prices.buyYesCents });
        }}
      />
      {banners.map((message) => (
        <p key={message} className={styles.warning} role="status">{message}</p>
      ))}
      <div className={styles.summary}>
        {sentence !== null ? <p className={styles.sentence}>{sentence}</p> : <span />}
        <div className={styles.odds}>
          <div className={styles.yes}>{formatPercent(view.market.prices.buyYesCents)}</div>
          {change !== null ? (
            <div className={styles.change} data-trend={change > 0 ? "up" : change < 0 ? "down" : "flat"}>
              {signedPoints(change)} today
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.layout}>
        <div className={styles.main}>
          <CrowdChart
            view={view}
            timeframe={timeframe}
            onTimeframe={onTimeframe}
            moves={moves}
            active={selected?.index}
            onPick={(index) => {
              const order = moves.findIndex((move) => move.index === index);
              if (order >= 0) setActiveMove(order + 1);
            }}
          />
          {moves.length > 0 ? (
            <section className={styles.section} aria-label="Why it moved">
              <h2 className={styles.heading}>Why it moved</h2>
              <ul className={styles.moves}>
                {[...moves].reverse().map((move, reversed) => {
                  const number = moves.length - reversed;
                  const active = selected === move;
                  return (
                    <li key={`${String(move.t)}:${move.title}`}>
                      <button
                        type="button"
                        className={styles.move}
                        data-active={active}
                        onClick={() => { setActiveMove(number); }}
                      >
                        <span className={styles.badge}>{String(number)}</span>
                        <span className={styles.moveBody}>
                          <span className={styles.moveTitle}>{move.title}</span>
                          <span className={styles.moveSrc}>{move.source}</span>
                        </span>
                        <span className={styles.moveDelta} data-up={move.deltaCents >= 0}>{signedPoints(move.deltaCents)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <ResolutionCard resolution={resolution} rulesText={view.market.rulesText} />
          {drivers !== null ? (
            <div className={styles.drivers}>
              <section className={styles.section} aria-label="What could push it up">
                <h2 className={styles.heading}>What could push it up</h2>
                {drivers.up.length > 0 ? (
                  <ul className={styles.driverList}>{drivers.up.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : <p className={styles.empty}>No upward factors could be read from the official rules.</p>}
              </section>
              <section className={styles.section} aria-label="What could pull it down">
                <h2 className={styles.heading}>What could pull it down</h2>
                {drivers.down.length > 0 ? (
                  <ul className={styles.driverList}>{drivers.down.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : <p className={styles.empty}>No downward factors could be read from the official rules.</p>}
              </section>
            </div>
          ) : null}
          <Chatter posts={view.matchedPosts} nowMs={Number.isFinite(nowMs) ? nowMs : Date.now()} />
          <Related markets={view.related} />
        </div>
        <aside className={styles.rail} aria-label="Trade and research">
          <TradeCard view={view} />
          {trust.length > 0 ? (
            <section className={styles.card} aria-label="Can you trust these odds">
              <h2 className={styles.heading}>Can you trust these odds?</h2>
              <div className={styles.trustList}>
                {trust.map((line) => (
                  <p key={line.kind} className={styles.trustLine} data-tone={line.tone}>{line.text}</p>
                ))}
              </div>
            </section>
          ) : null}
          <BriefCard symbol={view.symbol} yesCents={view.market.prices.buyYesCents} />
        </aside>
      </div>
    </div>
  );
}

function CrowdChart({
  view,
  timeframe,
  onTimeframe,
  moves,
  active,
  onPick,
}: {
  readonly view: ResearchView;
  readonly timeframe: ResearchTimeframe;
  readonly onTimeframe: (timeframe: ResearchTimeframe) => void;
  readonly moves: readonly CrowdMove[];
  readonly active: number | undefined;
  readonly onPick: (index: number) => void;
}) {
  const points = view.series.points;
  const geometry = buildChartGeometry(points, true, CHART_BOX);
  const first = points[0];
  const area = first === undefined || geometry.line === ""
    ? ""
    : `M${String(geometry.xs[0] ?? 0)} ${String(geometry.plotBottom)} ${geometry.line.replace(/^M/u, "L")} L${String(geometry.xs.at(-1) ?? 0)} ${String(geometry.plotBottom)} Z`;
  const selected = isBeginnerTimeframe(timeframe) ? timeframe : "1D";
  return (
    <section className={styles.section} aria-label="Odds chart">
      <div className={styles.chartHead}>
        <h2 className={styles.heading}>How the crowd's view changed</h2>
        <div className={styles.ranges} role="group" aria-label="Time range">
          {BEGINNER_TIMEFRAMES.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.range}
              aria-pressed={option === selected}
              onClick={() => { onTimeframe(option); }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.source}>{historySourceLabel(view)}</p>
      {points.length === 0 ? (
        <p className={styles.empty}>No price history yet for this range.</p>
      ) : (
        <div className={styles.chartFrame}>
          <svg className={styles.chart} viewBox={`0 0 ${String(CHART_BOX.width)} ${String(CHART_BOX.height)}`} role="img" aria-label="How the Yes odds changed">
            {geometry.yTicks.map((tick) => (
              <g key={tick.value}>
                <line className={styles.gridLine} x1={CHART_BOX.left} x2={CHART_BOX.width - CHART_BOX.right} y1={tick.y} y2={tick.y} />
                <text className={styles.axisText} x={CHART_BOX.left - 6} y={tick.y + 4} textAnchor="end">{`${String(tick.value)}%`}</text>
              </g>
            ))}
            {geometry.xTicks.map((tick) => (
              <text key={tick.t} className={styles.axisText} x={tick.x} y={CHART_BOX.height - 4} textAnchor="middle">{formatAxisTime(tick.t, geometry.spanMs)}</text>
            ))}
            {area !== "" ? <path className={styles.area} d={area} /> : null}
            {geometry.bars.map((bar) => (
              <rect key={bar.x} className={styles.volumeBar} x={bar.x} y={bar.y} width={bar.width} height={bar.height} />
            ))}
            {points.length > 1 ? <path className={styles.line} d={geometry.line} /> : null}
          </svg>
          {moves.map((move, order) => {
            const x = geometry.xs[move.index];
            const y = geometry.ys[move.index];
            if (x === undefined || y === undefined) return null;
            return (
              <button
                key={`${String(move.t)}:${move.title}`}
                type="button"
                className={styles.pin}
                data-active={move.index === active}
                style={{ left: `${String((x / CHART_BOX.width) * 100)}%`, top: `${String((y / CHART_BOX.height) * 100)}%` }}
                aria-label={`Event ${String(order + 1)}: ${move.title}`}
                onClick={() => { onPick(move.index); }}
              >
                {String(order + 1)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResolutionCard({ resolution, rulesText }: { readonly resolution: ReturnType<typeof parseResolution>; readonly rulesText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.section} aria-label="How this market resolves">
      <h2 className={styles.heading}>How this resolves</h2>
      <div className={styles.card}>
        {resolution.yesIf !== null ? (
          <div>
            <p className={styles.factLabel}>YES if</p>
            <p className={styles.factValue}>{resolution.yesIf}</p>
          </div>
        ) : null}
        {resolution.priceSource !== null ? (
          <div>
            <p className={styles.factLabel}>Price source</p>
            <p className={styles.factValue}>{resolution.priceSource}</p>
          </div>
        ) : null}
        <div>
          <p className={styles.factLabel}>Payout</p>
          <p className={styles.factValue}>{resolution.payout}</p>
        </div>
        {resolution.caveat !== null ? <p className={styles.caveat}>{resolution.caveat}</p> : null}
        {resolution.rulesUrl !== null ? (
          <a className={styles.rulesLink} href={resolution.rulesUrl} target="_blank" rel="noopener noreferrer">Read the full rules →</a>
        ) : resolution.hasRules ? (
          <button type="button" className={styles.rulesLink} onClick={() => { setOpen((value) => !value); }}>
            {open ? "Hide the full rules" : "Read the full rules →"}
          </button>
        ) : (
          <p className={styles.empty}>Gemini did not publish rules text for this market.</p>
        )}
        {open ? <p className={styles.rulesText}>{rulesText}</p> : null}
      </div>
    </section>
  );
}

function Chatter({ posts, nowMs }: { readonly posts: ResearchView["matchedPosts"]; readonly nowMs: number }) {
  return (
    <section className={styles.section} aria-label="Chatter on X">
      <div className={styles.chatterHead}>
        <h2 className={styles.heading}>Chatter on X</h2>
      </div>
      {posts.length === 0 ? (
        <p className={styles.empty}>No matched posts from the X feed yet for this market.</p>
      ) : (
        <div className={styles.posts}>
          {posts.map((post) => (
            <article key={`${post.source}:${post.url ?? post.text}`} className={styles.post}>
              <div className={styles.postMeta}>
                {post.author ?? (post.source === "x-feed" ? "Matched X post" : "News")}
                {post.atMs !== null ? ` · ${relativeTime(post.atMs, nowMs)}` : ""}
              </div>
              <p className={styles.postText}>{post.text}</p>
              {post.url !== null && isSafeHttpUrl(post.url) ? (
                <a href={post.url} target="_blank" rel="noopener noreferrer">Open the post ↗</a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Related({ markets }: { readonly markets: ResearchView["related"] }) {
  const items = [...markets.sameEvent, ...markets.sameCategory].slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Related markets">
      <h2 className={styles.heading}>Related markets</h2>
      <div className={styles.related}>
        {items.map((item) => (
          <Link key={item.symbol} href={`/markets/${encodeURIComponent(item.symbol)}`} className={styles.relatedCard}>
            <span>{item.eventTitle}{item.contractLabel !== "" ? ` · ${item.contractLabel}` : ""}</span>
            <span className={styles.relatedPct}>{formatPercent(item.yesCents)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function BriefCard({ symbol, yesCents }: { readonly symbol: string; readonly yesCents: number | null }) {
  const [current, setCurrent] = useState<StoredBrief | null>(null);
  const [previous, setPrevious] = useState<StoredBrief | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePolling(() => {
    void loadResearchBriefs(symbol).then((result) => {
      if (result.kind === "ready") {
        setCurrent(result.current);
        setPrevious(result.previous);
      }
    });
  }, WATCH_MS);
  const refresh = async () => {
    setBusy(true);
    setError(null);
    const purchase = await purchaseDeepDive(symbol);
    setBusy(false);
    if (purchase.kind === "error") {
      setError(purchase.message);
      return;
    }
    if (purchase.result.brief !== null && purchase.result.purchase !== null) {
      const next: StoredBrief = {
        at: purchase.result.purchase.at,
        signature: purchase.result.purchase.signature,
        explorerUrl: purchase.result.purchase.explorerUrl,
        costCents: purchase.result.purchase.costCents,
        yesCents: yesCentsFromBrief(purchase.result.brief),
        brief: purchase.result.brief,
      };
      setPrevious(current);
      setCurrent(next);
    } else if (purchase.result.failureReason !== null) {
      setError(purchase.result.failureReason);
    }
  };
  const stale = current === null ? null : briefStaleCopy(Date.parse(current.at), current.yesCents, yesCents);
  return (
    <section className={styles.card} aria-label="Deep dive">
      <div className={styles.briefHead}>
        <h2 className={styles.heading}>Your brief</h2>
        {stale?.needsRefresh === true ? <span className={styles.badgeNote}>Needs refresh</span> : null}
      </div>
      {current === null ? (
        <p className={styles.briefSummary}>No brief purchased for this market yet. The desk's agent can buy one for $0.05 over x402, inside the same daily budget as its bets.</p>
      ) : (
        <>
          {stale !== null ? <p className={styles.briefSummary}>{stale.summary}</p> : null}
          <BriefBody brief={current.brief} />
        </>
      )}
      {error !== null ? <p className={styles.warning} role="alert">{error}</p> : null}
      <button type="button" className={styles.refresh} disabled={busy} onClick={() => { void refresh(); }}>
        {busy ? "Paying…" : current === null ? "Buy a brief for $0.05" : "Refresh for $0.05"}
      </button>
      {previous !== null ? (
        <button type="button" className={styles.older} onClick={() => { setShowOlder((value) => !value); }}>
          {showOlder ? "Hide the older brief" : "Read the older brief"}
        </button>
      ) : null}
      {showOlder && previous !== null ? <BriefBody brief={previous.brief} /> : null}
    </section>
  );
}

function BriefBody({ brief }: { readonly brief: ResearchBrief }) {
  return (
    <article>
      <h3 className={styles.briefHeadline}>{brief.headline}</h3>
      {brief.sections.map((section) => (
        <section key={section.title} className={styles.briefSection}>
          <h3>{section.title}</h3>
          <p>{section.body}</p>
        </section>
      ))}
    </article>
  );
}
