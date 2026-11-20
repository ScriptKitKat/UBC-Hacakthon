"use client";

import Link from "next/link";
import { useState } from "react";
import type { PendingView } from "@/shared";
import { formatDollars } from "./format";
import { usePolling } from "./use-polling";
import styles from "./desk.module.css";

function relativeTime(iso: string, nowMs: number): string {
  const atMs = Date.parse(iso);
  if (!Number.isFinite(atMs)) return "";
  const elapsed = nowMs - atMs;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${String(Math.max(1, Math.round(elapsed / 60_000)))}m ago`;
  if (elapsed < 24 * 3_600_000) return `${String(Math.max(1, Math.round(elapsed / 3_600_000)))}h ago`;
  return `${String(Math.max(1, Math.round(elapsed / (24 * 3_600_000))))}d ago`;
}

export function ApprovalsPanel({
  pending,
  busy,
  onApprove,
  onReject,
}: {
  readonly pending: readonly PendingView[];
  readonly busy: boolean;
  readonly onApprove: (intentId: string) => void;
  readonly onReject: (intentId: string) => void;
}) {
  const [nowMs, setNowMs] = useState(0);
  usePolling(() => { setNowMs(Date.now()); }, 60_000);
  return (
    <section id="approvals" className={`${styles.panel ?? ""} ${styles.approvals ?? ""}`} aria-labelledby="approvals-title" aria-busy={busy}>
      <div className={styles.approvalsHead}>
        <h2 id="approvals-title" className={styles.panelTitle}>Waiting for your approval</h2>
        <span className={styles.approvalCount} aria-label={`${String(pending.length)} pending trades`}>{pending.length}</span>
      </div>
      {pending.length === 0 ? (
        <p className={styles.approvalsEmpty}>Nothing is waiting for approval.</p>
      ) : (
        <div className={styles.approvalList}>
          {pending.map((trade) => (
            <article key={trade.intentId} className={styles.approvalRow}>
              <div className={styles.approvalDetails}>
                <Link className={styles.approvalSymbol} href={`/markets/${encodeURIComponent(trade.symbol)}`}>{trade.symbol}</Link>
                <div className={styles.approvalMeta}>
                  <span>{trade.outcome === "yes" ? "Yes" : "No"}</span>
                  <span>{formatDollars(trade.notionalCents)}</span>
                  <span>Proposed by {trade.senderId}</span>
                  <time dateTime={trade.createdAt}>{relativeTime(trade.createdAt, nowMs)}</time>
                </div>
              </div>
              <div className={styles.approvalActions}>
                <button
                  type="button"
                  className={`${styles.approvalButton ?? ""} ${styles.approvalApprove ?? ""}`}
                  disabled={busy}
                  onClick={() => { onApprove(trade.intentId); }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={`${styles.approvalButton ?? ""} ${styles.approvalReject ?? ""}`}
                  disabled={busy}
                  onClick={() => { onReject(trade.intentId); }}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
