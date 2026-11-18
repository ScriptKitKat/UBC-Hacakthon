import type { DecisionKind, DecisionLogEntry } from "@/shared";
import { formatClock, formatDollars } from "./format";
import styles from "./desk.module.css";

const BADGES: Record<DecisionKind, { readonly label: string; readonly className: string }> = {
  approve: { label: "Approved", className: styles.badgeApprove ?? "" },
  "needs-approval": { label: "Needs approval", className: styles.badgePending ?? "" },
  refuse: { label: "Refused", className: styles.badgeRefuse ?? "" },
  "execution-failed": { label: "Failed", className: styles.badgeFailed ?? "" },
};

export function LatestDecision({ entry }: { readonly entry: DecisionLogEntry | undefined }) {
  if (!entry) return <p className={styles.quoteEmpty}>No decisions yet.</p>;
  return (
    <blockquote className={styles.quote} data-kind={entry.kind}>
      “{entry.spokenReason}”
    </blockquote>
  );
}

export function LogPanel({ log }: { readonly log: readonly DecisionLogEntry[] }) {
  return (
    <section className={styles.panelWide} aria-labelledby="log-heading">
      <h2 id="log-heading" className={styles.panelTitle}>Trade log</h2>
      {log.length === 0 ? (
        <p className={styles.empty}>No trades yet. Decisions appear here, newest first.</p>
      ) : (
        <ul className={styles.log}>
          {log.map((entry) => (
            <li key={entry.entryId} className={styles.logRow}>
              <span className={styles.logTime}>{formatClock(entry.at)}</span>
              <span className={BADGES[entry.kind].className}>{BADGES[entry.kind].label}</span>
              <span className={styles.logTrade}>
                {formatDollars(entry.notionalCents)} {entry.outcome.toUpperCase()} · {entry.symbol}
              </span>
              <span className={styles.logReason}>{entry.spokenReason}</span>
              <span className={styles.logProof}>
                {entry.signature && entry.explorerUrl ? (
                  <a href={entry.explorerUrl} target="_blank" rel="noreferrer" title={entry.signature}>
                    {entry.signature.slice(0, 8)}…{entry.signature.slice(-6)}
                  </a>
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
