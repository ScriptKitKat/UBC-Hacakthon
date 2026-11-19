import Link from "next/link";
import type { DecisionKind, DecisionLogEntry } from "@/shared";
import { formatClock, formatDollars, shortenMiddle } from "./format";
import { SpeakerIcon } from "./icons";
import styles from "./desk.module.css";

const BADGES: Record<DecisionKind, { readonly label: string; readonly className: string }> = {
  approve: { label: "Filled", className: styles.badgeApprove ?? "" },
  "needs-approval": { label: "Needs approval", className: styles.badgePending ?? "" },
  refuse: { label: "Refused", className: styles.badgeRefuse ?? "" },
  "execution-failed": { label: "Failed", className: styles.badgeFailed ?? "" },
};

export function LatestDecision({ entry }: { readonly entry: DecisionLogEntry | undefined }) {
  if (!entry) return <p className={styles.quoteEmpty}>No decisions yet.</p>;
  return (
    <figure className={styles.quote} data-kind={entry.kind}>
      <span className={styles.quoteIcon}>
        <SpeakerIcon />
      </span>
      <div className={styles.quoteBody}>
        <figcaption className={styles.quoteLabel}>Desk said · {BADGES[entry.kind].label}</figcaption>
        <blockquote className={styles.quoteText}>“{entry.spokenReason}”</blockquote>
      </div>
    </figure>
  );
}

export function LogPanel({ log }: { readonly log: readonly DecisionLogEntry[] }) {
  return (
    <section className={styles.panelWide} aria-labelledby="log-heading">
      <h2 id="log-heading" className={styles.panelTitle}>Decision log</h2>
      {log.length === 0 ? (
        <p className={styles.empty}>No trades yet. Decisions appear here, newest first.</p>
      ) : (
        <ul className={styles.log}>
          {log.map((entry) => (
            <li key={entry.entryId} className={styles.logRow}>
              <span className={styles.logTime}>{formatClock(entry.at)}</span>
              <span className={BADGES[entry.kind].className}>{BADGES[entry.kind].label}</span>
              <span className={styles.logTrade}>
                <span className={styles.logTradeTop}>
                  <span className={entry.outcome === "yes" ? styles.pillYes : styles.pillNo}>{entry.outcome.toUpperCase()}</span>
                  <span className={styles.logAmount}>{formatDollars(entry.notionalCents)}</span>
                </span>
                <Link className={styles.logSymbol} href={`/markets/${entry.symbol}`} title="Research this market">{entry.symbol}</Link>
                <span className={styles.logSender}>{entry.source === "feed" ? `X feed card · ${entry.senderId}` : entry.senderId}</span>
              </span>
              <span className={styles.logReason}>{entry.spokenReason}</span>
              <span className={styles.logProof}>
                {entry.signature && entry.explorerUrl ? (
                  <>
                    <a className={styles.explorerLink} href={entry.explorerUrl} target="_blank" rel="noreferrer" title={entry.signature}>
                      View on Solana Explorer ↗
                    </a>
                    <span className={styles.signature}>{shortenMiddle(entry.signature, 8, 6)}</span>
                  </>
                ) : null}
                {entry.ticket ? <span className={styles.ticket}>paper ticket {entry.ticket.ticketId.slice(0, 8)} · {entry.ticket.quantity} @ {entry.ticket.price}</span> : null}
                {entry.code ? <span className={styles.code}>{entry.code}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
