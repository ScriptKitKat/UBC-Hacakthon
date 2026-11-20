import type { LedgerView, PolicyView } from "@/shared";
import { budgetTone, formatDollars, percentOf, shortenMiddle } from "./format";
import styles from "./desk.module.css";

interface GuardrailPanelProps {
  readonly policy: PolicyView;
  readonly ledger: LedgerView;
  readonly busy: boolean;
  readonly onKillSwitch: (on: boolean) => void;
}

function shorten(key: string): string {
  return shortenMiddle(key, 5, 5);
}

export function GuardrailPanel({ policy, ledger, busy, onKillSwitch }: GuardrailPanelProps) {
  const spentShare = percentOf(policy.spentCents, policy.dailyCapCents);
  const autoApproveShare = percentOf(policy.autoApproveMaxCents, policy.dailyCapCents);
  const tone = budgetTone(policy.remainingCents, policy.dailyCapCents);
  return (
    <section className={styles.panel} aria-labelledby="guardrail-heading">
      <h2 id="guardrail-heading" className={styles.panelTitle}>Guardrails</h2>
      <p className={styles.budgetLine}>
        <span className={styles.budgetSpent}>{formatDollars(policy.spentCents)}</span> of {formatDollars(policy.dailyCapCents)} spent today
      </p>
      {policy.researchSpentCents > 0 ? (
        <p className={styles.researchLine}>
          <span className={styles.badgeResearch}>Research</span> {formatDollars(policy.researchSpentCents)} of that bought deep dives
        </p>
      ) : null}
      <div
        className={styles.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={policy.dailyCapCents}
        aria-valuenow={policy.spentCents}
        aria-label="Daily spend limit"
        data-tone={tone}
      >
        <div className={styles.meterFill} style={{ width: `${String(spentShare)}%` }} />
        <div
          className={styles.meterTick}
          style={{ left: `${String(autoApproveShare)}%` }}
          title={`Auto-approve up to ${formatDollars(policy.autoApproveMaxCents)}`}
        />
      </div>
      <p className={styles.remaining} data-tone={tone}>{formatDollars(policy.remainingCents)} remaining</p>
      <dl className={styles.facts}>
        <dt>Auto-approve up to</dt>
        <dd>{formatDollars(policy.autoApproveMaxCents)}</dd>
        <dt>Per-trade limit</dt>
        <dd>{formatDollars(policy.perTradeMaxCents)}</dd>
        <dt>Categories</dt>
        <dd>
          <ul className={styles.chips}>
            {policy.marketCategories.map((category) => (
              <li key={category}>{category}</li>
            ))}
          </ul>
        </dd>
        {policy.marketAllowlist.length > 0 ? (
          <>
            <dt>Allowlist</dt>
            <dd>
              <ul className={styles.chips}>
                {policy.marketAllowlist.map((symbol) => (
                  <li key={symbol}>{symbol}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
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
        <span className={styles.killTrack} aria-hidden="true">
          <span className={styles.killKnob} />
        </span>
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
