"use client";

import { useState } from "react";
import {
  formatPercent,
  marketDeadline,
  marketTitle,
  needsApprovalNote,
  overTradeLimitMessage,
  parseDollarsToCents,
  payoutFor,
  safeHttpsUrl,
} from "@/shared";
import type { DecisionLogEntry, PayoutResult, ResearchView, TradeBudget } from "@/shared";
import { monogramFor } from "../_market-card/model";
import { loadRail } from "../_shell/api";
import type { HomeRail } from "../_shell/api";
import { usePolling } from "../_desk/use-polling";
import { placeDeskTrade } from "./api";
import styles from "./trade-card.module.css";

const RAIL_MS = 15_000;

type Side = "yes" | "no";

function budgetFrom(rail: HomeRail | undefined): TradeBudget | undefined {
  if (rail === undefined) return undefined;
  return { perTradeMaxCents: rail.perTradeMaxCents, remainingCents: rail.remainingCents, autoApproveMaxCents: rail.autoApproveMaxCents };
}

function formatDollars(cents: number): string {
  return `$${(Math.floor(cents) / 100).toFixed(2)}`;
}

function problemText(payout: PayoutResult | undefined, side: Side): string | null {
  if (payout === undefined || payout.kind === "quote") return null;
  if (payout.kind === "no-price") return `Gemini has no live ${side === "yes" ? "Yes" : "No"} price right now`;
  return "That amount is below the smallest order for this market";
}

export function TradeCard({ view }: { readonly view: ResearchView }) {
  const [side, setSide] = useState<Side>("yes");
  const [amountText, setAmountText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [rail, setRail] = useState<HomeRail | undefined>(undefined);
  const [result, setResult] = useState<DecisionLogEntry | { readonly error: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  usePolling(() => { void loadRail().then(setRail); }, RAIL_MS);
  const budget = budgetFrom(rail);
  const { prices, quantityLimits } = view.market;
  const title = marketTitle(view);
  const icon = safeHttpsUrl(view.market.imageUrl);
  const closes = marketDeadline(view);
  const contract = view.market.contractLabel.trim();
  const amountCents = parseDollarsToCents(amountText);
  const priceCents = side === "yes" ? prices.buyYesCents : prices.buyNoCents;
  const payout = amountCents === undefined || amountCents <= 0
    ? undefined
    : quantityLimits ? payoutFor(priceCents, amountCents, quantityLimits) : payoutFor(priceCents, amountCents);
  const over = amountCents === undefined ? null : overTradeLimitMessage(amountCents, budget);
  const approval = amountCents === undefined ? null : needsApprovalNote(amountCents, budget);
  const senderId = rail?.senderAllowlist[0] ?? "";
  const canBuy = amountCents !== undefined && payout?.kind === "quote" && over === null && !busy && rail?.killSwitch !== true && senderId !== "";
  const buy = async () => {
    if (amountCents === undefined || senderId === "" || over !== null) return;
    setBusy(true);
    setResult(undefined);
    const placed = await placeDeskTrade({ symbol: view.symbol, outcome: side, senderId, notionalCents: amountCents });
    setResult(placed.ok ? placed.entry : { error: placed.message });
    setBusy(false);
    setReviewing(false);
    void loadRail().then(setRail);
  };
  const sideLabel = side === "yes" ? "Yes" : "No";
  const problem = problemText(payout, side);
  const choose = (next: Side) => {
    setSide(next);
    setReviewing(false);
  };
  return (
    <section className={styles.card} aria-label="Make a prediction">
      <h2 className={styles.heading}>Make a prediction</h2>
      <div className={styles.head}>
        {icon !== null ? <img className={styles.icon} src={icon} alt="" /> : <span className={styles.icon} aria-hidden="true">{monogramFor(title)}</span>}
        <div className={styles.titles}>
          <p className={styles.title}>{title}</p>
          {contract !== "" ? <p className={styles.contract}>{contract}</p> : null}
        </div>
      </div>
      <div className={styles.outcomes} role="group" aria-label="Prediction outcome">
        <button type="button" className={styles.outcome} data-outcome="yes" aria-pressed={side === "yes"} onClick={() => { choose("yes"); }}>
          <span className={styles.outcomePrice}>Yes {prices.buyYesCents === null ? "—" : `${String(Math.round(prices.buyYesCents))}¢`}</span>
          <span className={styles.outcomeChance}>{formatPercent(prices.buyYesCents)} chance</span>
        </button>
        <button type="button" className={styles.outcome} data-outcome="no" aria-pressed={side === "no"} onClick={() => { choose("no"); }}>
          <span className={styles.outcomePrice}>No {prices.buyNoCents === null ? "—" : `${String(Math.round(prices.buyNoCents))}¢`}</span>
          <span className={styles.outcomeChance}>{formatPercent(prices.buyNoCents)} chance</span>
        </button>
      </div>
      <label className={styles.amountField}>
        <span className={styles.amountLabel}>Amount</span>
        <span className={styles.amountValue}>
          <input
            className={styles.amountInput}
            inputMode="decimal"
            value={amountText}
            placeholder="0.00"
            aria-label="Amount in USDC"
            onChange={(event) => {
              setAmountText(event.target.value);
              setReviewing(false);
            }}
          />
          <span className={styles.amountUnit} aria-hidden="true">USDC</span>
        </span>
      </label>
      {payout === undefined ? <p className={styles.estimate}>Enter an amount to see what you could win or lose.</p> : null}
      {problem !== null ? <p className={styles.estimate}>{problem}</p> : null}
      {payout?.kind === "quote" ? (
        <dl className={styles.results} aria-live="polite">
          <div className={styles.result} data-tone="win">
            <dt>If {sideLabel} happens</dt>
            <dd>You get {formatDollars(payout.payoutCents)} <span>(+{formatDollars(payout.profitCents)})</span></dd>
          </div>
          <div className={styles.result} data-tone="lose">
            <dt>If it doesn&apos;t</dt>
            <dd>You lose {formatDollars(payout.costCents)}</dd>
          </div>
        </dl>
      ) : null}
      {closes !== null ? <p className={styles.note}>Your money stays in this bet until the market ends. {closes}.</p> : null}
      {over !== null ? <p className={styles.note} data-tone="warn">{over}</p> : null}
      {approval !== null && over === null ? <p className={styles.note} data-tone="warn">{approval}</p> : null}
      {reviewing && payout?.kind === "quote" ? (
        <div className={styles.review}>
          <p className={styles.reviewText}>
            You&apos;re putting {formatDollars(payout.costCents)} on {sideLabel} at {String(Math.round(payout.priceCents))}¢ a share. You need {sideLabel} to be more likely than {String(Math.round(payout.breakEvenPercent))}% for this to pay off over time.
          </p>
          <div className={styles.reviewActions}>
            <button type="button" className={styles.back} disabled={busy} onClick={() => { setReviewing(false); }}>Back</button>
            <button type="button" className={styles.buy} disabled={!canBuy} onClick={() => { void buy(); }}>
              {busy ? "Placing order…" : "Confirm prediction"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.buy} disabled={!canBuy} onClick={() => { setReviewing(true); }}>
          Review prediction
        </button>
      )}
      {result !== undefined && "error" in result ? <p className={styles.note} data-tone="warn" role="alert">{result.error}</p> : null}
      {result !== undefined && "kind" in result ? <p className={styles.note} data-kind={result.kind} role="status">{result.spokenReason}</p> : null}
    </section>
  );
}
