"use client";

import { useState } from "react";
import { loadSnapshot, postAction } from "./api";
import type { ActionResult, SnapshotResult } from "./api";
import { GuardrailPanel } from "./guardrail-panel";
import { LatestDecision, LogPanel } from "./log-panel";
import { MarketPanel } from "./market-panel";
import { NewsPanel } from "./news-panel";
import { TradePanel } from "./trade-panel";
import type { BetRequest } from "./trade-panel";
import { usePolling } from "./use-polling";
import { VoicePanel } from "./voice-panel";
import { XThreadPanel } from "./x-thread-panel";
import styles from "./desk.module.css";

const POLL_INTERVAL_MS = 4000;

export function Dashboard() {
  const [result, setResult] = useState<SnapshotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    void loadSnapshot().then(setResult);
  };
  usePolling(refresh, POLL_INTERVAL_MS);

  const run = (action: () => Promise<ActionResult>) => {
    setBusy(true);
    setActionError(null);
    void action()
      .then((outcome) => {
        if (!outcome.ok) setActionError(outcome.message);
        return loadSnapshot();
      })
      .then(setResult)
      .finally(() => {
        setBusy(false);
      });
  };

  if (result === null) return <p className={styles.status}>Connecting to the desk…</p>;

  if (result.kind === "not-configured") {
    return (
      <section className={styles.panelWide} role="alert">
        <h2 className={styles.panelTitle}>Desk is not configured</h2>
        <ul className={styles.issues}>
          {result.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p className={styles.empty}>Set these variables in .env.local and restart the server.</p>
      </section>
    );
  }

  if (result.kind === "error") {
    return (
      <section className={styles.panelWide} role="alert">
        <h2 className={styles.panelTitle}>Desk unavailable</h2>
        <p className={styles.warning}>{result.message}</p>
        <button type="button" className={styles.secondaryButton} onClick={refresh}>Retry</button>
      </section>
    );
  }

  const { snapshot } = result;
  return (
    <div className={styles.grid}>
      {actionError ? <p className={styles.banner} role="alert">{actionError}</p> : null}
      <VoicePanel onTrade={refresh} />
      <div className={styles.topRow}>
        <NewsPanel
          news={snapshot.news}
          busy={busy}
          onSubmit={(text) => {
            run(() => postAction("news", { text, author: "desk" }));
          }}
        />
        <MarketPanel match={snapshot.match} />
      </div>
      <LatestDecision entry={snapshot.log[0]} />
      <div className={styles.midRow}>
        <TradePanel
          match={snapshot.match}
          senders={snapshot.policy.senderAllowlist}
          pending={snapshot.pending}
          busy={busy}
          onBet={(bet: BetRequest) => {
            run(() => postAction("propose", { ...bet, source: "desk" }));
          }}
          onApprove={(intentId, approverId) => {
            run(() => postAction("confirm", { intentId, approverId }));
          }}
        />
        <GuardrailPanel
          policy={snapshot.policy}
          ledger={snapshot.ledger}
          busy={busy}
          onKillSwitch={(on) => {
            run(() => postAction("kill-switch", { on }));
          }}
        />
      </div>
      <XThreadPanel senders={snapshot.policy.senderAllowlist} />
      <LogPanel log={snapshot.log} />
    </div>
  );
}
