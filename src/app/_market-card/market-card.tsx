"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatPercent } from "@/shared";
import { StarButton } from "../_watchlist/star-button";
import type { MarketCardModel } from "./model";
import styles from "./market-card.module.css";

export interface MarketCardWatch {
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly label?: string;
}

export function MarketCardGrid({ children }: { readonly children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function MarketCardSkeletonGrid({ count }: { readonly count: number }) {
  return (
    <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={[styles.card, styles.skeleton].join(" ")}>
          <div className={[styles.bone, styles.boneCategory].join(" ")} />
          <div className={styles.titleRow}>
            <div className={[styles.bone, styles.boneIcon].join(" ")} />
            <div className={[styles.bone, styles.boneTitle].join(" ")} />
          </div>
          <div className={[styles.bone, styles.boneLine].join(" ")} />
          <div className={styles.outcomes}>
            <div className={[styles.bone, styles.bonePill].join(" ")} />
            <div className={[styles.bone, styles.bonePill].join(" ")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketIcon({ url, monogram }: { readonly url: string | null; readonly monogram: string }) {
  if (url === null) return <span className={styles.icon} aria-hidden="true">{monogram}</span>;
  return <img className={styles.icon} src={url} alt="" loading="lazy" decoding="async" />;
}

export function MarketCard({
  model,
  watch,
  selected,
  footStart,
  footEnd,
}: {
  readonly model: MarketCardModel;
  readonly watch?: MarketCardWatch;
  readonly selected?: boolean;
  readonly footStart?: ReactNode;
  readonly footEnd?: ReactNode;
}) {
  const hasFoot = footStart !== undefined || footEnd !== undefined;
  return (
    <article className={styles.card} data-selected={selected === true} aria-label={model.title}>
      <div className={styles.head}>
        <span className={styles.category}>{model.category}</span>
        <div className={styles.headEnd}>
          {model.live ? <span className={styles.live}><span className={styles.liveDot} aria-hidden="true" />Live</span> : null}
          {model.change !== null ? <span className={styles.change} data-trend={model.change.trend}>{model.change.label}</span> : null}
          {watch !== undefined ? <StarButton pressed={watch.pressed} onToggle={watch.onToggle} {...(watch.label === undefined ? {} : { label: watch.label })} /> : null}
        </div>
      </div>
      <div className={styles.titleRow}>
        <MarketIcon url={model.iconUrl} monogram={model.monogram} />
        <Link href={model.href} className={styles.title}>{model.title}</Link>
      </div>
      {model.detail !== null || model.closes !== null ? (
        <div className={styles.details}>
          {model.detail !== null ? <p className={styles.detail}>{model.detail}</p> : null}
          {model.closes !== null ? <p className={styles.closes}>{model.closes}</p> : null}
        </div>
      ) : null}
      <div className={styles.outcomes}>
        {model.outcomes.map((outcome) => (
          <div key={outcome.key} className={styles.outcome}>
            <span className={styles.outcomeLabel}>{outcome.label}</span>
            {outcome.payout !== null ? <span className={styles.payout}>{outcome.payout}</span> : null}
            <span className={styles.pill} aria-label={`${formatPercent(outcome.percent)} chance`}>{formatPercent(outcome.percent)}</span>
          </div>
        ))}
      </div>
      {hasFoot ? (
        <div className={styles.foot}>
          <div className={styles.footStart}>{footStart}</div>
          <div className={styles.footEnd}>{footEnd}</div>
        </div>
      ) : null}
    </article>
  );
}
