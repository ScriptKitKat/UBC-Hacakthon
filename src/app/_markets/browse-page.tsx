"use client";

import { useState } from "react";
import type { BrowsePage, BrowseSort } from "@/shared";
import { uniqueByKey } from "@/shared";
import { useViewMode } from "../_research/use-view-mode";
import { usePolling } from "../_desk/use-polling";
import { loadBrowse, loadSpots } from "../_shell/api";
import { MarketCard, MarketCardGrid, MarketCardSkeletonGrid } from "../_market-card/market-card";
import { browseCardModel } from "../_market-card/model";
import { useWatchlist } from "../_watchlist/use-watchlist";
import styles from "./markets.module.css";

const POLL_MS = 30_000;
const FALLBACK_TABS: readonly { id: string; label: string; live: boolean }[] = [
  { id: "All", label: "All", live: false },
  { id: "Live", label: "Live", live: true },
  { id: "Sports", label: "Sports", live: false },
  { id: "Crypto", label: "Crypto", live: false },
  { id: "Economy", label: "Economy", live: false },
  { id: "Politics", label: "Politics", live: false },
  { id: "Tech and AI", label: "Tech and AI", live: false },
  { id: "Weather", label: "Weather", live: false },
  { id: "Culture", label: "Culture", live: false },
  { id: "Commodities", label: "Commodities", live: false },
];
const SORTS: readonly { value: BrowseSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "closing", label: "Closing soon" },
  { value: "newest", label: "Newest" },
  { value: "move", label: "Biggest move" },
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function BrowsePage({ initialPage }: { readonly initialPage?: BrowsePage } = {}) {
  const [mode] = useViewMode();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<BrowseSort>("trending");
  const [page, setPage] = useState<BrowsePage | undefined>(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const visibleCount = Math.min(Math.max(page?.markets.length ?? 24, 24), 96);

  usePolling(() => {
    void loadBrowse({
      sort,
      category,
      offset: 0,
      limit: visibleCount,
      ...(submitted ? { search: submitted } : {}),
    }).then(async (result) => {
      if (result.kind !== "ok") {
        setError(result.message);
        return;
      }
      setPage({
        ...result.page,
        markets: uniqueByKey(result.page.markets, (card) => card.eventTicker),
      });
      setError(null);
      const assets = [...new Set(result.page.markets.flatMap((card) => {
        const match = /^([A-Z]+)/u.exec(card.eventTicker);
        return card.kind === "crypto" && match?.[1] ? [match[1]] : [];
      }))];
      if (assets.length === 0) return;
      const spots = await loadSpots(assets);
      if (Object.keys(spots).length === 0) return;
      setPage((current) => {
        if (current === undefined) return current;
        return {
          ...current,
          markets: current.markets.map((card) => {
            const match = /^([A-Z]+)/u.exec(card.eventTicker);
            const asset = match?.[1];
            const label = asset === undefined ? undefined : spots[asset];
            return label === undefined ? card : { ...card, spotLabel: label };
          }),
        };
      });
    }).catch(() => {
      setError("Live markets are unavailable right now.");
    });
  }, POLL_MS + tick);

  const markets = page?.markets ?? [];
  const tabs = page?.tabs ?? FALLBACK_TABS;
  const beginner = mode === "beginner";
  const watchlist = useWatchlist();

  const resetList = (next: Partial<{ category: string; sort: BrowseSort; search: string }>) => {
    if (next.category !== undefined) setCategory(next.category);
    if (next.sort !== undefined) setSort(next.sort);
    if (next.search !== undefined) setSubmitted(next.search);
    setPage(undefined);
    setTick((value) => value + 1);
  };

  const loadMore = () => {
    if (page === undefined || !page.hasMore || loadingMore) return;
    setLoadingMore(true);
    const nextCount = Math.min(page.markets.length + 24, 96);
    void loadBrowse({
      sort,
      category,
      offset: 0,
      limit: nextCount,
      ...(submitted ? { search: submitted } : {}),
    }).then((result) => {
      setLoadingMore(false);
      if (result.kind !== "ok") {
        setError(result.message);
        return;
      }
      setPage({
        ...result.page,
        markets: uniqueByKey(result.page.markets, (card) => card.eventTicker),
        offset: 0,
      });
    }).catch(() => {
      setLoadingMore(false);
      setError("Live markets are unavailable right now.");
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Markets</h1>
        <form className={styles.search} onSubmit={(event) => { event.preventDefault(); resetList({ search: search.trim() }); }}>
          <label htmlFor="msearch" className={styles.hidden}>Search markets</label>
          <SearchIcon />
          <input id="msearch" value={search} placeholder="Search markets" onChange={(event) => { setSearch(event.target.value); }} />
        </form>
      </header>

      <div className={styles.tabsRow}>
        <div className={styles.tabs} role="tablist" aria-label="Categories">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={tab.live ? [styles.tab, styles.tabLive].join(" ") : (styles.tab ?? "")}
              aria-selected={category === tab.id}
              onClick={() => { resetList({ category: tab.id }); }}
            >
              {tab.live ? <span className={styles.liveDot} /> : null}
              {tab.label}
            </button>
          ))}
        </div>
        <label className={styles.sort}>
          <span className={styles.hidden}>Sort</span>
          Sort:{" "}
          <select value={sort} aria-label="Sort markets" onChange={(event) => { resetList({ sort: event.target.value as BrowseSort }); }}>
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.body}>
        {beginner ? (
          <div className={styles.explainer}>
            <span className={styles.explainerPct}>62%</span>
            <span>means the crowd thinks it&apos;s 62% likely. Each share costs 62¢ and pays $1 if it happens. Tap a market to research and trade.</span>
          </div>
        ) : null}
        {error ? <p className={styles.status} role="alert">{error}</p> : null}
        {page?.stale === true ? <p className={styles.status} role="status">Showing recent markets while Gemini cools down.</p> : null}
        {error === null && page === undefined ? (
          <>
            <p className={styles.status}>Loading live markets…</p>
            <MarketCardSkeletonGrid count={8} />
          </>
        ) : null}
        {error === null && page !== undefined && markets.length === 0 ? <p className={styles.status}>No live markets match that search right now.</p> : null}
        {markets.length > 0 ? (
          <MarketCardGrid>
            {markets.map((card) => {
              const lead = card.rows.find((row) => row.instrumentSymbol === card.instrumentSymbol) ?? card.rows[0];
              return (
                <MarketCard
                  key={card.eventTicker}
                  model={browseCardModel(card, beginner)}
                  watch={{
                    pressed: watchlist.starred(card.eventTicker, card.instrumentSymbol),
                    onToggle: () => {
                      void watchlist.toggle({ eventTicker: card.eventTicker, instrumentSymbol: card.instrumentSymbol, yesCents: lead?.yesCents ?? null });
                    },
                  }}
                  footStart={card.moreCount > 0 ? <span>+{String(card.moreCount)} more</span> : undefined}
                />
              );
            })}
          </MarketCardGrid>
        ) : null}
        {page?.hasMore === true ? (
          <div className={styles.moreWrap}>
            <button type="button" className={styles.moreBtn} disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading more…" : "Load more markets"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
