import type { ResearchDepthLevel, ResearchTrade, ResearchView } from "@/shared";
import { formatClockTime, formatPriceCents, formatVolume } from "./format";
import { Tip } from "./tip";
import styles from "./research.module.css";

function DepthSide({ levels, tone, maxCumulative }: { readonly levels: readonly ResearchDepthLevel[]; readonly tone: "bid" | "ask"; readonly maxCumulative: number }) {
  if (levels.length === 0) return <p className={styles.empty}>No {tone === "bid" ? "buy" : "sell"} orders waiting.</p>;
  return (
    <ul className={styles.depthList} data-tone={tone}>
      {levels.map((level) => (
        <li key={level.priceCents} className={styles.depthRow}>
          <span className={styles.depthBar} style={{ width: `${String(maxCumulative === 0 ? 0 : (level.cumulative / maxCumulative) * 100)}%` }} aria-hidden="true" />
          <Tip text={`${formatVolume(level.amount)} contracts at ${formatPriceCents(level.priceCents)}; ${formatVolume(level.cumulative)} in total up to this price.`}>
            <span className={styles.depthPrice}>{formatPriceCents(level.priceCents)}</span>
          </Tip>
          <span className={styles.depthAmount}>{formatVolume(level.amount)}</span>
          <span className={styles.depthTotal}>{formatVolume(level.cumulative)}</span>
        </li>
      ))}
    </ul>
  );
}

export function OrderBookPanel({ book, available }: { readonly book: ResearchView["book"]; readonly available: boolean }) {
  const maxCumulative = Math.max(0, ...book.bids.map((level) => level.cumulative), ...book.asks.map((level) => level.cumulative));
  return (
    <section className={styles.panel} aria-labelledby="book-heading">
      <h2 id="book-heading" className={styles.panelTitle}>
        <Tip text="Waiting buy orders (bids) and sell orders (asks) for YES, with the running total at each price.">Order book depth</Tip>
      </h2>
      {available ? (
        <div className={styles.depthColumns}>
          <div>
            <h3 className={styles.subTitle}>Bids · buyers</h3>
            <DepthSide levels={book.bids} tone="bid" maxCumulative={maxCumulative} />
          </div>
          <div>
            <h3 className={styles.subTitle}>Asks · sellers</h3>
            <DepthSide levels={book.asks} tone="ask" maxCumulative={maxCumulative} />
          </div>
        </div>
      ) : (
        <p className={styles.warning}>Gemini's order book is unavailable right now.</p>
      )}
    </section>
  );
}

export function TradesPanel({ trades, available }: { readonly trades: readonly ResearchTrade[]; readonly available: boolean }) {
  return (
    <section className={styles.panel} aria-labelledby="trades-heading">
      <h2 id="trades-heading" className={styles.panelTitle}>Recent trades</h2>
      {!available ? <p className={styles.warning}>Gemini's trade feed is unavailable right now.</p> : null}
      {available && trades.length === 0 ? <p className={styles.empty}>No trades yet.</p> : null}
      {trades.length > 0 ? (
        <ul className={styles.tradeList}>
          {trades.slice(0, 12).map((trade) => (
            <li key={trade.tradeId} className={styles.tradeRow} data-side={trade.side}>
              <span className={styles.tradeTime}>{formatClockTime(trade.timeMs)}</span>
              <Tip text={trade.side === "buy" ? "A buyer paid the asking price." : "A seller hit the bid."}>
                <span className={styles.tradeSide}>{trade.side}</span>
              </Tip>
              <span>{formatPriceCents(trade.priceCents)}</span>
              <span className={styles.tradeAmount}>{formatVolume(trade.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
