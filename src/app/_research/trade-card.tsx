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
const DEFAULT_AMOUNT = "2.00";

type Side = "yes" | "no";

function budgetFrom(rail: HomeRail | undefined): TradeBudget | undefined {
  if (rail === undefined) return undefined;
  return { perTradeMaxCents: rail.perTradeMaxCents, remainingCents: rail.remainingCents, autoApproveMaxCents: rail.autoApproveMaxCents };
}

function formatUsdc(cents: number): string {
  return `${(Math.floor(cents) / 100).toFixed(2)} USDC`;
}

function estimateText(payout: PayoutResult | undefined, priceCents: number | null, side: Side): string {
  if (payout === undefined) return "Enter an amount";
  if (payout.kind === "quote") return `${formatPercent(priceCents)} chance · ${formatUsdc(payout.payoutCents)} potential payout`;
  if (payout.kind === "no-price") return `Gemini has no live ${side === "yes" ? "Yes" : "No"} price right now`;
  return "That amount is below the smallest order for this market";
}

export function TradeCard({ view }: { readonly view: ResearchView }) {
  const [side, setSide] = useState<Side>("yes");
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
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
    void loadRail().then(setRail);
  };
  return (
    <section className={styles.card} aria-label="Place a bet">
      <div className={styles.head}>
        {icon !== null ? <img className={styles.icon} src={icon} alt="" /> : <span className={styles.icon} aria-hidden="true">{monogramFor(title)}</span>}
        <div className={styles.titles}>
          <p className={styles.title}>{title}</p>
          {closes !== null ? <p className={styles.deadline}>{closes}</p> : null}
        </div>
      </div>
      {contract !== "" ? <p className={styles.contract}>{contract}</p> : null}
      <div className={styles.outcomes} role="group" aria-label="Prediction outcome">
        <button type="button" className={styles.outcome} data-outcome="yes" aria-pressed={side === "yes"} onClick={() => { setSide("yes"); }}>
          Yes {formatPercent(prices.buyYesCents)}
        </button>
        <button type="button" className={styles.outcome} data-outcome="no" aria-pressed={side === "no"} onClick={() => { setSide("no"); }}>
          No {formatPercent(prices.buyNoCents)}
        </button>
      </div>
      <label className={styles.amountField}>
        <span className={styles.amountLabel}>Amount</span>
        <span className={styles.amountValue}>
          <input className={styles.amountInput} inputMode="decimal" value={amountText} aria-label="Amount in USDC" onChange={(event) => { setAmountText(event.target.value); }} />
          <span className={styles.amountUnit} aria-hidden="true">USDC</span>
        </span>
      </label>
      <p className={styles.estimate} aria-live="polite">{estimateText(payout, priceCents, side)}</p>
      {over !== null ? <p className={styles.note} data-tone="warn">{over}</p> : null}
      {approval !== null && over === null ? <p className={styles.note} data-tone="warn">{approval}</p> : null}
      <button type="button" className={styles.buy} disabled={!canBuy} onClick={() => { void buy(); }}>
        {busy ? "Placing order…" : "Trade now"}
      </button>
      {result !== undefined && "error" in result ? <p className={styles.note} data-tone="warn" role="alert">{result.error}</p> : null}
      {result !== undefined && "kind" in result ? <p className={styles.note} data-kind={result.kind} role="status">{result.spokenReason}</p> : null}
    </section>
  );
}
