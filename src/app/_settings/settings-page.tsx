"use client";

import { useState } from "react";
import { loadSnapshot, postAction } from "../_desk/api";
import type { ActionResult, SnapshotResult } from "../_desk/api";
import { GuardrailPanel } from "../_desk/guardrail-panel";
import { usePolling } from "../_desk/use-polling";
import { PageHero } from "../_shell/page-hero";
import styles from "./settings.module.css";

const POLL_MS = 8000;

export function SettingsPage() {
  const [result, setResult] = useState<SnapshotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  usePolling(() => {
    void loadSnapshot().then(setResult);
  }, POLL_MS);

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

  return (
    <div className={styles.page}>
      <PageHero title="Settings" lead="Spending limits and the switch that stops all trading." />
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
      {result === null ? <p className={styles.empty}>Loading policy…</p> : null}
      {result?.kind === "not-configured" ? (
        <div className={styles.notice}>
          <p className={styles.noticeTitle}>The desk is not set up yet.</p>
          <ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      ) : null}
      {result?.kind === "error" ? <p className={styles.error} role="alert">{result.message}</p> : null}
      {result?.kind === "ready" ? (
        <GuardrailPanel
            policy={result.snapshot.policy}
            ledger={result.snapshot.ledger}
            busy={busy}
            onKillSwitch={(on) => {
              run(() => postAction("kill-switch", { on }));
            }}
          />
      ) : null}
    </div>
  );
}
