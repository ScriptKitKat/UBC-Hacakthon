import type { ResearchView } from "@/shared";
import { formatCountdown, formatPriceCents, formatVolume } from "./format";
import { Tip } from "./tip";
import styles from "./research.module.css";

type Market = ResearchView["market"];

export function MarketHeader({ market, nowMs }: { readonly market: Market; readonly nowMs: number }) {
  const { buyYesCents, buyNoCents } = market.prices;
  const open = market.marketState === "open" && market.eventStatus === "active";
  return (
    <section className={styles.panelWide} aria-labelledby="market-title">
      <div className={styles.headTop}>
        <div className={styles.headTitles}>
          <p className={styles.eyebrow}>
            {market.category}
            {market.subcategory !== null && market.subcategory !== market.category ? ` · ${market.subcategory}` : ""}
          </p>
          <h1 id="market-title" className={styles.title}>
            {market.eventTitle}
          </h1>
          <p className={styles.contract}>{market.contractLabel}</p>
        </div>
        <div className={styles.headMeta}>
          <span className={open ? styles.stateOpen : styles.stateClosed}>
            <span className={styles.stateDot} aria-hidden="true" />
            {market.marketState}
          </span>
          <Tip text="When the market stops trading and pays out.">
            <span className={styles.countdown}>{formatCountdown(market.expiryDate, nowMs)}</span>
          </Tip>
        </div>
      </div>
      <div className={styles.oddsRow}>
        <div className={styles.oddsYes}>
          <span className={styles.oddsLabel}>Yes</span>
          <Tip text="The price to buy YES. If it happens you receive $1 per contract.">
            <span className={styles.oddsValue}>{formatPriceCents(buyYesCents)}</span>
          </Tip>
          <Tip text="The price of YES, read as a probability.">
            <span className={styles.oddsChance}>{buyYesCents === null ? "no live price" : `${String(Math.round(buyYesCents))}% chance`}</span>
          </Tip>
        </div>
        <div className={styles.oddsNo}>
          <span className={styles.oddsLabel}>No</span>
          <Tip text="The price to buy NO, taken straight from Gemini. If it does not happen you receive $1 per contract.">
            <span className={styles.oddsValue}>{formatPriceCents(buyNoCents)}</span>
          </Tip>
          <span className={styles.oddsChance}>{buyNoCents === null ? "no live price" : `${String(Math.round(buyNoCents))}% paid for NO`}</span>
        </div>
        <dl className={styles.statGrid}>
          <Stat label="Best bid" tip="The highest price a buyer is offering right now." value={formatPriceCents(market.prices.bestBidCents)} />
          <Stat label="Best ask" tip="The lowest price a seller is asking right now." value={formatPriceCents(market.prices.bestAskCents)} />
          <Stat label="Last trade" tip="The price of the most recent trade." value={formatPriceCents(market.prices.lastTradeCents)} />
          <Stat label="Volume" tip="Total contracts traded in this event so far." value={formatVolume(market.volume)} />
          <Stat label="24h volume" tip="Contracts traded in this event in the last 24 hours." value={formatVolume(market.volume24h)} />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, tip, value }: { readonly label: string; readonly tip: string; readonly value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <Tip text={tip}>{value}</Tip>
      </dd>
    </div>
  );
}

export function RulesPanel({ rulesText }: { readonly rulesText: string }) {
  return (
    <section className={styles.panel} aria-labelledby="rules-heading">
      <h2 id="rules-heading" className={styles.panelTitle}>How this market resolves</h2>
      <p className={styles.rules}>{rulesText === "" ? "Gemini did not publish rules text for this market." : rulesText}</p>
    </section>
  );
}
