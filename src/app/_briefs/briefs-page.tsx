"use client";

import Link from "next/link";
import { useState } from "react";
import { formatClock, shortenMiddle } from "../_desk/format";
import { usePolling } from "../_desk/use-polling";
import { loadPositions } from "../_positions/api";
import type { PositionsResult } from "../_positions/api";
import { formatDollarsFromCents } from "../_research/format";
import styles from "../_home/home.module.css";

const POLL_MS = 15_000;

export function BriefsPage() {
  const [result, setResult] = useState<PositionsResult | null>(null);
  usePolling(() => {
    void loadPositions().then(setResult);
  }, POLL_MS);

  const purchases = result?.kind === "ready" ? result.view.researchSpend.purchases : [];

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Briefs</h1>
      <p className={styles.pageLead}>Deep-dive research reports you have already purchased. This is not a catalog of sample briefs.</p>
      {result === null ? <p className={styles.empty}>Loading purchased briefs…</p> : null}
      {result?.kind === "not-configured" ? <p className={styles.empty}>The desk is not configured, so there are no purchased briefs to show.</p> : null}
      {result?.kind === "error" ? <p className={styles.error} role="alert">{result.message}</p> : null}
      {result?.kind === "ready" && purchases.length === 0 ? (
        <p className={styles.empty}>No deep dives purchased yet. Open a market and buy a research brief there.</p>
      ) : null}
      {purchases.length > 0 ? (
        <ul className={styles.briefList}>
          {purchases.map((purchase) => (
            <li key={purchase.entryId} className={styles.briefItem}>
              <Link href={`/markets/${encodeURIComponent(purchase.symbol)}`}>{purchase.symbol}</Link>
              <div className={styles.briefMeta}>
                {formatClock(purchase.at)} · {formatDollarsFromCents(purchase.costCents)}
              </div>
              {purchase.explorerUrl !== null && purchase.signature !== null ? (
                <a href={purchase.explorerUrl} target="_blank" rel="noopener noreferrer">
                  View on Solana Explorer ↗ {shortenMiddle(purchase.signature, 8, 6)}
                </a>
              ) : (
                <span className={styles.briefMeta}>No explorer link recorded</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
