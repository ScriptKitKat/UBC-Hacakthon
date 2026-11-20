"use client";

import Link from "next/link";
import { formatEndLine, safeHttpsUrl, volumeLabel } from "@/shared";
import { monogramFor } from "../_market-card/model";
import { useViewMode } from "../_research/use-view-mode";
import { StarButton } from "../_watchlist/star-button";
import styles from "./market-header.module.css";

export interface MarketHeaderModel {
  readonly category: string;
  readonly title: string;
  readonly iconUrl: string | null;
  readonly monogram: string;
  readonly meta: readonly string[];
}

export function marketHeaderModel(input: {
  readonly category: string;
  readonly title: string;
  readonly imageUrl: string | null | undefined;
  readonly expiryDate: string | null;
  readonly volume: number | null;
  readonly nowMs: number;
}): MarketHeaderModel {
  const ends = formatEndLine(input.expiryDate, input.nowMs);
  const trimmed = input.category.trim();
  return {
    category: trimmed === "" ? "Other" : trimmed.toLowerCase() === "economics" ? "Economy" : trimmed,
    title: input.title,
    iconUrl: safeHttpsUrl(input.imageUrl),
    monogram: monogramFor(input.title),
    meta: [ends.ends, ends.daysLeft, volumeLabel(input.volume)].filter((item) => item !== null),
  };
}

export function MarketHeader({
  model,
  watched,
  onToggleWatch,
}: {
  readonly model: MarketHeaderModel;
  readonly watched: boolean;
  readonly onToggleWatch: () => void;
}) {
  const [mode, setMode] = useViewMode();
  return (
    <header className={styles.header}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/markets">Markets</Link>
        <span aria-hidden="true">/</span>
        <span>{model.category}</span>
      </nav>
      <div className={styles.row}>
        <div className={styles.identity}>
          {model.iconUrl !== null
            ? <img className={styles.icon} src={model.iconUrl} alt="" />
            : <span className={styles.icon} aria-hidden="true">{model.monogram}</span>}
          <div className={styles.titles}>
            <h1 className={styles.title}>{model.title}</h1>
            {model.meta.length > 0 ? (
              <p className={styles.meta}>{model.meta.map((item) => <span key={item}>{item}</span>)}</p>
            ) : null}
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.mode} role="group" aria-label="Mode">
            <button type="button" className={styles.modeButton} aria-pressed={mode === "beginner"} onClick={() => { setMode("beginner"); }}>Beginner</button>
            <button type="button" className={styles.modeButton} aria-pressed={mode === "pro"} onClick={() => { setMode("pro"); }}>Pro</button>
          </div>
          <StarButton pressed={watched} onToggle={onToggleWatch} />
        </div>
      </div>
    </header>
  );
}
