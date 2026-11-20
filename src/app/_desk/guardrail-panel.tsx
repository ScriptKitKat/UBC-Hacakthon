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
    <div className={styles.layout}>
    <section className={styles.panel} aria-labelledby="guardrail-heading">
      <h2 id="guardrail-heading" className={styles.panelTitle}>Spending limits</h2>
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
      <p className={styles.remaining} data-tone={tone}>{formatDollars(policy.remainingCents)} left today</p>
      <dl className={styles.facts}>
        <dt>Auto-approve up to<small>Smaller trades go through without asking you</small></dt>
        <dd>{formatDollars(policy.autoApproveMaxCents)}</dd>
        <dt>Most you can put on one trade</dt>
        <dd>{formatDollars(policy.perTradeMaxCents)}</dd>
        <dt>Categories you can trade</dt>
        <dd>
          <ul className={styles.chips}>
            {policy.marketCategories.map((category) => (
              <li key={category}>{category}</li>
            ))}
          </ul>
        </dd>
        {policy.marketAllowlist.length > 0 ? (
          <>
            <dt>Markets you can trade</dt>
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
    </section>
    <div className={styles.side}>
      <section className={styles.kill} data-on={policy.killSwitch} aria-labelledby="kill-heading">
        <div className={styles.killHead}>
          <h2 id="kill-heading" className={styles.killTitle}>{policy.killSwitch ? "Trading is paused" : "Trading is on"}</h2>
          <button
            type="button"
            role="switch"
            aria-checked={!policy.killSwitch}
            aria-label="Trading"
            className={styles.killSwitch}
            disabled={busy}
            onClick={() => {
              onKillSwitch(!policy.killSwitch);
            }}
          >
            <span className={styles.killKnob} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.killText}>
          {policy.killSwitch
            ? "No new trades can go through. Turn this back on to start trading again."
            : "Turn this off to stop every new trade right away, including trades from agents and voice."}
        </p>
      </section>
      {ledger.configured ? (
        <p className={styles.ledgerLine}>
          Ledger {ledger.cluster}: authority {shorten(ledger.authority)} → {shorten(ledger.recipient)} · mint {shorten(ledger.mint)}
        </p>
      ) : (
        <p className={styles.warning}>
          <strong>Wallet not connected</strong>
          Trades won&apos;t go through until the Solana wallet is set up. Missing: {ledger.missing.join(", ")}.
        </p>
      )}
    </div>
    </div>
  );
}
