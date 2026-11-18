import type { LedgerView, PolicyView } from "@/shared";
import { formatDollars } from "./format";
import styles from "./desk.module.css";

interface GuardrailPanelProps {
  readonly policy: PolicyView;
  readonly ledger: LedgerView;
  readonly busy: boolean;
  readonly onKillSwitch: (on: boolean) => void;
}

function shorten(key: string): string {
  return key.length > 12 ? `${key.slice(0, 5)}…${key.slice(-5)}` : key;
}

export function GuardrailPanel({ policy, ledger, busy, onKillSwitch }: GuardrailPanelProps) {
  const spentShare = policy.dailyCapCents === 0 ? 0 : Math.min(100, (policy.spentCents / policy.dailyCapCents) * 100);
  return (
    <section className={styles.panel} aria-labelledby="guardrail-heading">
      <h2 id="guardrail-heading" className={styles.panelTitle}>Guardrails</h2>
      <p className={styles.budgetLine}>
        <span className={styles.budgetSpent}>{formatDollars(policy.spentCents)}</span> of {formatDollars(policy.dailyCapCents)} spent today
      </p>
      <div
        className={styles.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={policy.dailyCapCents}
        aria-valuenow={policy.spentCents}
        aria-label="Daily budget"
      >
        <div className={styles.meterFill} style={{ width: `${String(spentShare)}%` }} />
      </div>
      <p className={styles.remaining}>{formatDollars(policy.remainingCents)} remaining</p>
      <dl className={styles.facts}>
        <dt>Auto-approve up to</dt>
        <dd>{formatDollars(policy.autoApproveMaxCents)}</dd>
        <dt>Per-trade limit</dt>
        <dd>{formatDollars(policy.perTradeMaxCents)}</dd>
        <dt>Allowlist</dt>
        <dd>
          <ul className={styles.chips}>
            {policy.marketAllowlist.map((symbol) => (
              <li key={symbol}>{symbol}</li>
            ))}
          </ul>
        </dd>
      </dl>
      <button
        type="button"
        role="switch"
        aria-checked={policy.killSwitch}
        className={policy.killSwitch ? styles.killOn : styles.killOff}
        disabled={busy}
        onClick={() => {
          onKillSwitch(!policy.killSwitch);
        }}
      >
        {policy.killSwitch ? "Kill switch ON — trading paused" : "Kill switch off — trading live"}
      </button>
      {ledger.configured ? (
        <p className={styles.ledgerLine}>
          Ledger {ledger.cluster}: authority {shorten(ledger.authority)} → {shorten(ledger.recipient)} · mint {shorten(ledger.mint)}
        </p>
      ) : (
        <p className={styles.warning}>Ledger not configured. Missing: {ledger.missing.join(", ")}. Trades will not execute.</p>
      )}
    </section>
  );
}
