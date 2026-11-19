"use client";

import Link from "next/link";
import { useState } from "react";
import type { WatchlistCard, WatchlistView } from "@/shared";
import { buildSparkline, changeTrend, formatPercent, friendlyEventTitle } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadWatchlistCards } from "../_shell/api";
import { StarButton } from "./star-button";
import {
  endsMeta,
  filterWatchlist,
  savedAtLabel,
  sortWatchlist,
  todayChangeLabel,
  type WatchlistFilter,
  type WatchlistSort,
} from "./query";
import { useWatchlist } from "./use-watchlist";
import styles from "./watchlist.module.css";

const POLL_MS = 30_000;
const CHART_WIDTH = 110;
const CHART_HEIGHT = 34;
const FILTERS: readonly { value: WatchlistFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "moving", label: "Moving" },
  { value: "closing", label: "Closing soon" },
];
const SORTS: readonly { value: WatchlistSort; label: string }[] = [
  { value: "move", label: "Biggest move" },
  { value: "closing", label: "Closing soon" },
  { value: "saved", label: "Recently saved" },
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function WatchlistPreview({
  card,
  onToggle,
}: {
  readonly card: WatchlistCard;
  readonly onToggle: () => void;
}) {
  const title = friendlyEventTitle(card.eventTitle, card.expiryDate);
  const sparkline = buildSparkline(card.sparkline, CHART_WIDTH, CHART_HEIGHT, 2);
  const today = todayChangeLabel(card.todayPoints);
  const trend = sparkline?.trend ?? changeTrend(card.todayPoints);
  const saved = savedAtLabel(card);
  const savedParts = saved === null ? null : saved.split(" · ");
  return (
    <article className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <span>{endsMeta(card)}</span>
        <StarButton pressed onToggle={onToggle} label="Remove from watchlist" />
      </div>
      <Link href={card.href} className={styles.cardTitle}>{title}</Link>
      <div className={styles.oddsRow}>
        <div className={styles.oddsBlock}>
          <span className={styles.odds}>{formatPercent(card.yesCents)}</span>
          {today !== null ? <span className={styles.delta} data-trend={trend}>{today}</span> : null}
        </div>
        {sparkline !== undefined ? (
          <div className={styles.chart}>
            <svg viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`} role="img" aria-label="Yes price history">
              <path className={styles.line} d={sparkline.line} data-trend={sparkline.trend} />
            </svg>
          </div>
        ) : null}
      </div>
      {savedParts !== null ? (
        <div className={styles.saved}>
          Saved at <span className={styles.savedValue}>{formatPercent(card.savedYesCents)}</span>
          {savedParts[1] !== undefined ? ` · ${savedParts[1]}` : ""}
        </div>
      ) : null}
      <div className={styles.foot}>
        <Link href={card.href} className={styles.open}>Open</Link>
      </div>
    </article>
  );
}

export function WatchlistPage({ initialView }: { readonly initialView?: WatchlistView } = {}) {
  const watchlist = useWatchlist(initialView?.symbols ?? []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WatchlistFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("move");
  const [cards, setCards] = useState<readonly WatchlistCard[]>(initialView?.cards ?? []);
  const [loaded, setLoaded] = useState(initialView !== undefined);
  const [error, setError] = useState<string | null>(null);

  usePolling(() => {
    void loadWatchlistCards().then((result) => {
      if (result === undefined) {
        setError("The watchlist could not be loaded.");
        setLoaded(true);
        return;
      }
      setCards(result.cards ?? []);
      setError(null);
      setLoaded(true);
    });
  }, POLL_MS);

  const visibleCards = cards.filter((card) => watchlist.starred(card.eventTicker, card.instrumentSymbol));
  const shown = sortWatchlist(filterWatchlist(visibleCards, { filter, search }), sort);
  const savedCount = visibleCards.length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Watchlist</h1>
          <span className={styles.count}>{savedCount === 1 ? "1 saved market" : `${String(savedCount)} saved markets`}</span>
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); }}>
            <label htmlFor="wsearch" className={styles.hidden}>Search saved markets</label>
            <SearchIcon />
            <input id="wsearch" value={search} placeholder="Search saved markets" onChange={(event) => { setSearch(event.target.value); }} />
          </form>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Filter saved markets">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={styles.chip}
                aria-pressed={filter === item.value}
                onClick={() => { setFilter(item.value); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className={styles.sort}>
            Sort:{" "}
            <select value={sort} aria-label="Sort saved markets" onChange={(event) => { setSort(event.target.value as WatchlistSort); }}>
              {SORTS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className={styles.status} role="alert">{error}</p> : null}
        {error === null && !loaded ? <p className={styles.status}>Loading your watchlist…</p> : null}
        {error === null && loaded && savedCount === 0 ? (
          <div className={styles.empty}>
            <span>You have not saved any markets yet. On Markets, tap the star on a card to add it here.</span>
            <Link href="/markets" className={styles.emptyLink}>Browse markets</Link>
          </div>
        ) : null}
        {error === null && savedCount > 0 && shown.length === 0 ? (
          <p className={styles.status}>No saved markets match that search right now.</p>
        ) : null}
        {shown.length > 0 ? (
          <div className={styles.grid}>
            {shown.map((card) => (
              <WatchlistPreview
                key={card.eventTicker}
                card={card}
                onToggle={() => {
                  void watchlist.toggle({ eventTicker: card.eventTicker, instrumentSymbol: card.instrumentSymbol, yesCents: card.yesCents });
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
