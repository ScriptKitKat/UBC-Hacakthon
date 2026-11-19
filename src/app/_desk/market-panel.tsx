import Link from "next/link";
import type { MatchView } from "@/shared";
import { formatCents, formatChance, yesSharePercent } from "./format";
import styles from "./desk.module.css";

function Odds({ label, cents, tone }: { readonly label: string; readonly cents: number | null; readonly tone: "yes" | "no" }) {
  return (
    <div className={tone === "yes" ? styles.oddsYes : styles.oddsNo}>
      <span className={styles.oddsLabel}>{label}</span>
      <span className={styles.oddsValue}>{cents === null ? "n/a" : formatCents(cents)}</span>
      {cents === null ? null : <span className={styles.oddsChance}>{formatChance(cents)}</span>}
    </div>
  );
}

function ProbabilityBar({ yesCents, noCents }: { readonly yesCents: number | null; readonly noCents: number | null }) {
  const share = yesSharePercent(yesCents, noCents);
  if (share === undefined) return null;
  return (
    <div
      className={styles.probability}
      role="img"
      aria-label={`Yes ${String(Math.round(share))} percent, No ${String(Math.round(100 - share))} percent`}
    >
      <div className={styles.probabilityYes} style={{ width: `${String(share)}%` }} />
      <div className={styles.probabilityNo} />
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
        <div className={styles.marketBody}>
          <div className={styles.marketHead}>
            <p className={styles.eventTitle}>{match.market.eventTitle}</p>
            <span className={match.market.marketState === "open" ? styles.stateOpen : styles.stateClosed}>
              <span className={styles.stateDot} aria-hidden="true" />
              {match.market.marketState}
            </span>
          </div>
          <p className={styles.contractLabel}>{match.market.contractLabel}</p>
          <p className={styles.symbol}>{match.market.instrumentSymbol}</p>
          <p>
            <Link className={styles.researchLink} href={`/markets/${match.market.instrumentSymbol}`}>Research this market →</Link>
          </p>
          <div className={styles.oddsRow}>
            <Odds label="Yes" cents={match.market.yesCents} tone="yes" />
            <Odds label="No" cents={match.market.noCents} tone="no" />
          </div>
          <ProbabilityBar yesCents={match.market.yesCents} noCents={match.market.noCents} />
        </div>
      ) : null}
    </section>
  );
}
