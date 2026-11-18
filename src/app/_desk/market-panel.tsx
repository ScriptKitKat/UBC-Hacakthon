import type { MatchView } from "@/shared";
import { formatCents } from "./format";
import styles from "./desk.module.css";

function Odds({ label, cents, tone }: { readonly label: string; readonly cents: number | null; readonly tone: "yes" | "no" }) {
  return (
    <div className={tone === "yes" ? styles.oddsYes : styles.oddsNo}>
      <span className={styles.oddsLabel}>{label}</span>
      <span className={styles.oddsValue}>{cents === null ? "n/a" : formatCents(cents)}</span>
    </div>
  );
}

export function MarketPanel({ match }: { readonly match: MatchView }) {
  return (
    <section className={styles.panel} aria-labelledby="market-heading">
      <h2 id="market-heading" className={styles.panelTitle}>Matched market</h2>
      {match.kind === "no-news" ? <p className={styles.empty}>Submit news to find a market.</p> : null}
      {match.kind === "no-match" ? <p className={styles.warning}>No market matched. {match.reason}</p> : null}
      {match.kind === "matched" ? (
        <div>
          <p className={styles.eventTitle}>{match.market.eventTitle}</p>
          <p className={styles.contractLabel}>{match.market.contractLabel}</p>
          <p className={styles.symbol}>{match.market.instrumentSymbol}</p>
          <div className={styles.oddsRow}>
            <Odds label="Yes" cents={match.market.yesCents} tone="yes" />
            <Odds label="No" cents={match.market.noCents} tone="no" />
            <div className={styles.state}>
              <span className={styles.oddsLabel}>State</span>
              <span className={match.market.marketState === "open" ? styles.stateOpen : styles.stateClosed}>{match.market.marketState}</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
