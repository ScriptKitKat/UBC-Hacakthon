"use client";

import { useState } from "react";
import { ticketQuote, cappedStakeCents, needsApproval } from "@/features/market-pro";
import { formatBudgetCents, formatResetLabel, parseDollarsToCents } from "@/shared";
import type { ProBudget, ProMarket } from "@/shared";
import { proposeTrade } from "../../_shell/api";
import { budgetNote, formatCents, formatDollars } from "./format";
import { Tip } from "./tip";
import styles from "./pro.module.css";

const DEFAULT_STAKE = "5.00";

export function OrderTicket({ market, budget }: { readonly market: ProMarket; readonly budget: ProBudget }) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stakeText, setStakeText] = useState(DEFAULT_STAKE);
  const defaultProb = Math.round(market.yesAskCents ?? market.lastTradeCents ?? 50);
  const [est, setEst] = useState(Math.min(99, Math.max(1, defaultProb)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const price = side === "yes" ? market.yesAskCents : market.noAskCents;
  const parsedStake = parseDollarsToCents(stakeText);
  const stakeCents = parsedStake ?? 0;
  const remainingCap = Math.min(budget.remainingCents, budget.perTradeMaxCents);
  const quote = price === null || stakeCents <= 0
    ? { kind: "invalid" as const }
    : ticketQuote({ priceCents: price, stakeCents, believedYesPercent: est, side });
  const overLimit = stakeCents > remainingCap;
  const approval = needsApproval(Math.min(stakeCents, remainingCap), budget.autoApproveMaxCents);
  const canSubmit = price !== null && stakeCents > 0 && !overLimit && budget.senderId !== null && !busy && market.marketState === "open";
  const submit = () => {
    if (budget.senderId === null || price === null || stakeCents <= 0) return;
    const notional = cappedStakeCents(stakeCents, budget.remainingCents, budget.perTradeMaxCents);
    if (notional <= 0) return;
    setBusy(true);
    setMessage(null);
    void proposeTrade({ symbol: market.symbol, outcome: side, senderId: budget.senderId, notionalCents: notional }).then((result) => {
      setBusy(false);
      if (result.ok) {
        setMessage(approval ? "Sent. This is over the $2 auto-approve limit, so it is waiting for your OK." : "Sent. The desk placed a paper market order.");
        return;
      }
      setMessage(result.message);
    });
  };
  return (
    <section className={styles.ticket} aria-labelledby="ticket-heading">
      <h2 id="ticket-heading" className={styles.railTitle}>Order ticket</h2>
      <div className={styles.orderTypes} role="group" aria-label="Order type">
        <button type="button" disabled aria-pressed={false} title="Paper trading places market orders only.">Limit</button>
        <button type="button" aria-pressed={true}>Market</button>
      </div>
      <p className={styles.note}>Paper trading places market orders only. Limit orders are not supported by the paper flow.</p>
      <div className={styles.sides} role="group" aria-label="Side">
        <button type="button" className={side === "yes" ? styles.yesOn : undefined} aria-pressed={side === "yes"} onClick={() => { setSide("yes"); }}>
          Buy YES {market.yesAskCents === null ? "" : formatCents(market.yesAskCents)}
        </button>
        <button type="button" className={side === "no" ? styles.noOn : undefined} aria-pressed={side === "no"} onClick={() => { setSide("no"); }}>
          Buy NO {market.noAskCents === null ? "" : formatCents(market.noAskCents)}
        </button>
      </div>
      <div className={styles.fields}>
        <label>Stake
          <input inputMode="decimal" value={stakeText} onChange={(event) => { setStakeText(event.target.value); }} />
        </label>
      </div>
      <div className={styles.slider}>
        <div className={styles.sliderTop}>
          <label htmlFor="est">Your probability</label>
          <span>{String(est)}% YES</span>
        </div>
        <input id="est" type="range" min="1" max="99" step="1" value={est} onChange={(event) => { setEst(Number(event.target.value)); }} />
      </div>
      <dl className={styles.facts}>
        <dt>Shares</dt>
        <dd>{quote.kind === "invalid" ? "—" : quote.shares.toFixed(2)}</dd>
        <dt>Max payout</dt>
        <dd>{quote.kind === "invalid" ? "—" : formatDollars(quote.maxPayoutCents)}</dd>
        <dt>Break-even probability</dt>
        <dd>{quote.kind === "invalid" ? "—" : `${String(Math.round(quote.breakEvenPercent))}%`}</dd>
        <dt>Expected value</dt>
        <dd className={quote.kind === "invalid" ? undefined : quote.evCents >= 0 ? styles.up : styles.down}>
          {quote.kind === "invalid" ? "—" : `${formatDollars(quote.evCents, true)} (${quote.evPercent >= 0 ? "+" : "−"}${Math.abs(quote.evPercent).toFixed(0)}%)`}
        </dd>
        <dt>Kelly stake (of $10 cap)</dt>
        <dd>{quote.kind === "invalid" ? "—" : quote.kellyStakeCents > 0 ? `${formatDollars(quote.kellyStakeCents)} (${String(Math.round(quote.kellyFraction * 100))}%)` : "No bet"}</dd>
        <dt>
          <Tip text="Gemini does not publish the exchange fee for prediction market trades.">Fee</Tip>
        </dt>
        <dd>
          <Tip text="Gemini does not publish the exchange fee for prediction market trades.">—</Tip>
        </dd>
      </dl>
      <button type="button" className={styles.submit} disabled={!canSubmit} onClick={submit}>
        {approval ? "Needs approval" : "Place market"} · {side.toUpperCase()} {formatBudgetCents(stakeCents)}
      </button>
      <p className={overLimit ? [styles.hint, styles.warn].join(" ") : (styles.hint ?? "")}>
        {budgetNote(stakeCents, budget.remainingCents, budget.autoApproveMaxCents, remainingCap, budget.perTradeMaxCents)}
        {` · ${formatResetLabel(budget.resetAt, "America/Chicago")}`}
      </p>
      {budget.senderId === null ? <p className={styles.hint}>The desk has no allowed sender, so it cannot place this order.</p> : null}
      {message !== null ? <p className={styles.hint} role="status">{message}</p> : null}
    </section>
  );
}
