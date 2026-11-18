"use client";

import { useState } from "react";
import { loadSnapshot, postAction } from "./api";
import type { ActionResult, SnapshotResult } from "./api";
import { AppBar } from "./app-bar";
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

  if (result === null) {
    return (
      <div className={styles.grid}>
        <AppBar state={null} />
        <p className={styles.status}>Connecting to the desk…</p>
      </div>
    );
  }

  if (result.kind === "not-configured") {
    return (
      <div className={styles.grid}>
        <AppBar state={null} />
        <section className={styles.panelWide} role="alert">
          <h2 className={styles.panelTitle}>Desk is not configured</h2>
          <ul className={styles.issues}>
            {result.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p className={styles.empty}>Set these variables in .env.local and restart the server.</p>
        </section>
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className={styles.grid}>
        <AppBar state={null} />
        <section className={styles.panelWide} role="alert">
          <h2 className={styles.panelTitle}>Desk unavailable</h2>
          <p className={styles.warning}>{result.message}</p>
          <button type="button" className={styles.secondaryButton} onClick={refresh}>Retry</button>
        </section>
      </div>
    );
  }

  const { snapshot } = result;
  return (
    <div className={styles.grid}>
      <AppBar state={{ ledger: snapshot.ledger, killSwitch: snapshot.policy.killSwitch }} />
      {actionError ? <p className={styles.banner} role="alert">{actionError}</p> : null}
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
        <VoicePanel onTrade={refresh} />
      </div>
      <LogPanel log={snapshot.log} />
      <XThreadPanel senders={snapshot.policy.senderAllowlist} />
    </div>
  );
}
