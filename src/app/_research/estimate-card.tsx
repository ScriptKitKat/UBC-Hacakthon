"use client";

import { useState } from "react";
import { edgeFor, formatPercent } from "@/shared";
import type { EdgeResult } from "@/shared";
import styles from "./estimate-card.module.css";

function sideName(side: "yes" | "no"): string {
  return side === "yes" ? "Yes" : "No";
}

function verdict(edge: EdgeResult, estimate: number): string {
  if (edge.kind === "no-price") return "There is no live price to compare against right now.";
  if (edge.kind === "none") return `You're close to the crowd, so there's no edge here. Agreeing with the price doesn't make money over time.`;
  return `You think ${String(estimate)}%. ${sideName(edge.side)} costs ${String(edge.priceCents)}¢, so by your number ${sideName(edge.side)} looks cheap by ${String(edge.edgeCents)}¢ a share.`;
}

export function EstimateCard({ yesCents, noCents }: { readonly yesCents: number | null; readonly noCents: number | null }) {
  const [estimate, setEstimate] = useState<number | null>(null);
  const shown = estimate ?? yesCents ?? 50;
  const edge = estimate === null ? null : edgeFor(estimate, yesCents, noCents);
  return (
    <section className={styles.card} aria-label="What do you think">
      <h2 className={styles.heading}>What do you think?</h2>
      <p className={styles.lead}>
        The crowd says {formatPercent(yesCents)}. Drag to your own guess for Yes. You only come out ahead over time when the crowd is wrong.
      </p>
      <div className={styles.sliderRow}>
        <input
          className={styles.slider}
          type="range"
          min={1}
          max={99}
          step={1}
          value={shown}
          aria-label="Your chance for Yes, in percent"
          onChange={(event) => { setEstimate(Number(event.target.value)); }}
        />
        <output className={styles.value} data-set={estimate !== null}>{String(shown)}%</output>
      </div>
      {edge !== null ? (
        <p className={styles.verdict} data-kind={edge.kind} aria-live="polite">{verdict(edge, shown)}</p>
      ) : null}
      {edge?.kind === "edge" ? (
        <div className={styles.average}>
          <div className={styles.averageRow}>
            <span>On average, if your {String(shown)}% is right</span>
            <strong>+${(edge.averageCentsPerDollar / 100).toFixed(2)} per $1 on {sideName(edge.side)}</strong>
          </div>
          <p className={styles.averageNote}>
            {edge.lossesInTen > 0
              ? `Even then, you'd lose about ${String(edge.lossesInTen)} ${edge.lossesInTen === 1 ? "time" : "times"} out of 10. One loss doesn't make it a bad bet.`
              : "That's an average over many bets like this one, not a promise for this one."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
