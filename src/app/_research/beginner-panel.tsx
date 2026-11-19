"use client";

import { useState } from "react";
import { payoutFor } from "@/shared";
import type { PayoutResult, ResearchView } from "@/shared";
import { parseDollarsToCents } from "../_desk/format";
import { formatDollarsFromCents, formatPercent, formatPriceCents } from "./format";
import { Tip } from "./tip";
import styles from "./research.module.css";

type Prices = ResearchView["market"]["prices"];
type Limits = ResearchView["market"]["quantityLimits"];

const DEFAULT_STAKE = "10";

function PayoutCell({ side, price, result }: { readonly side: "yes" | "no"; readonly price: number | null; readonly result: PayoutResult }) {
  const label = side === "yes" ? "YES" : "NO";
  return (
    <div className={side === "yes" ? styles.payoutYes : styles.payoutNo}>
      <h3 className={styles.payoutTitle}>
        Buy {label} at {formatPriceCents(price)}
      </h3>
      {result.kind === "no-price" ? <p className={styles.warning}>Gemini has no live {label} price, so this can't be calculated.</p> : null}
      {result.kind === "invalid-stake" ? <p className={styles.empty}>Enter a dollar amount.</p> : null}
      {result.kind === "below-minimum" ? <p className={styles.warning}>That stake buys less than the smallest order of {String(result.minimumContracts)} contracts.</p> : null}
      {result.kind === "quote" ? (
        <dl className={styles.payoutFacts}>
          <div>
            <dt>Contracts</dt>
            <dd><Tip text="Each contract pays $1 if you are right and $0 if you are wrong.">{String(result.contracts)}</Tip></dd>
          </div>
          <div>
            <dt>Payout if right</dt>
            <dd><Tip text="Contracts × $1.">{formatDollarsFromCents(result.payoutCents)}</Tip></dd>
          </div>
          <div>
            <dt>Profit if right</dt>
            <dd><Tip text="Payout minus what you paid.">{formatDollarsFromCents(result.profitCents)}</Tip></dd>
          </div>
          <div>
            <dt>Return</dt>
            <dd><Tip text="Profit divided by what you paid.">{formatPercent(result.returnPercent)}</Tip></dd>
          </div>
          <div>
            <dt>If wrong</dt>
            <dd><Tip text="You lose what you paid.">{formatDollarsFromCents(-result.costCents)}</Tip></dd>
          </div>
          <div>
            <dt>Break-even chance</dt>
            <dd><Tip text="The real chance of this outcome has to be higher than the price for the bet to make money on average.">{String(result.breakEvenPercent)}%</Tip></dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

export function BeginnerPanel({ prices, limits }: { readonly prices: Prices; readonly limits: Limits }) {
  const [stakeText, setStakeText] = useState(DEFAULT_STAKE);
  const stakeCents = parseDollarsToCents(stakeText);
  const yes = prices.buyYesCents;
  const no = prices.buyNoCents;
  const yesResult = limits ? payoutFor(yes, stakeCents ?? 0, limits) : payoutFor(yes, stakeCents ?? 0);
  const noResult = limits ? payoutFor(no, stakeCents ?? 0, limits) : payoutFor(no, stakeCents ?? 0);
  return (
    <section className={styles.panelWide} aria-labelledby="beginner-heading">
      <h2 id="beginner-heading" className={styles.panelTitle}>New to prediction markets?</h2>
      <p className={styles.explainer}>
        {yes === null
          ? "Gemini has no live YES price for this market right now."
          : `${String(Math.round(yes))}¢ means the market thinks there's a ${String(Math.round(yes))}% chance. Pay ${String(Math.round(yes))}¢, get $1 if it happens.`}
      </p>
      <p className={styles.explainerNote}>
        {no === null
          ? "Gemini has no live NO price right now."
          : `The NO side is priced separately by Gemini at ${String(Math.round(no))}¢: pay that, get $1 if it does not happen.`}
        {yes !== null && no !== null && yes + no > 100 ? ` YES and NO together cost ${String(yes + no)}¢ for a single $1 payout; the extra ${String(yes + no - 100)}¢ is the gap between buyers and sellers.` : ""}
      </p>
      <div className={styles.calculator}>
        <label className={styles.fieldLabel} htmlFor="stake-input">
          <Tip text="How much you would spend, in US dollars.">Stake ($)</Tip>
        </label>
        <input
          id="stake-input"
          className={styles.input}
          inputMode="decimal"
          value={stakeText}
          aria-invalid={stakeCents === undefined || stakeCents <= 0}
          onChange={(event) => {
            setStakeText(event.target.value);
          }}
        />
        <div className={styles.payoutGrid}>
          <PayoutCell side="yes" price={yes} result={yesResult} />
          <PayoutCell side="no" price={no} result={noResult} />
        </div>
        <p className={styles.explainerNote}>
          This is arithmetic on today's prices, not a prediction or advice. Prices change, and you lose your stake if you are wrong.
        </p>
      </div>
    </section>
  );
}
