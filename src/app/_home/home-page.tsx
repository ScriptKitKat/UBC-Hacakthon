"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { isXUrl } from "@/shared";
import type { HomeView } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadHome, loadSparklines, matchQuery } from "../_shell/api";
import { ChevronIcon, RefreshIcon, SubmitIcon } from "../_shell/icons";
import { CHIP_CATEGORIES, FILTERS, PREFETCH_CATEGORIES, categoryKey } from "./category";
import { useWatchlist } from "../_watchlist/use-watchlist";
import { MarketCard } from "./market-card";
import styles from "./home.module.css";

const POLL_MS = 30_000;

function SkeletonGrid() {
  return (
    <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <div className={[styles.skeletonLine, styles.skeletonTitle].join(" ")} />
          <div className={styles.skeletonLine} />
          <div className={[styles.skeletonLine, styles.skeletonChart].join(" ")} />
        </div>
      ))}
    </div>
  );
}

function applySparklines(view: HomeView, updates: Readonly<Record<string, { readonly sparkline: readonly number[]; readonly changePercent: number | null }>>): HomeView {
  const markets = view.markets.map((card) => {
    const update = updates[card.instrumentSymbol];
    if (update === undefined) return card;
    return { ...card, sparkline: [...update.sparkline], changePercent: update.changePercent };
  });
  const sorted = [...markets].sort((left, right) => {
    const leftMove = left.changePercent === null ? -1 : Math.abs(left.changePercent);
    const rightMove = right.changePercent === null ? -1 : Math.abs(right.changePercent);
    return rightMove - leftMove;
  });
  return { ...view, markets: sorted };
}

async function fillSparklines(view: HomeView): Promise<HomeView> {
  const symbols = view.markets.filter((card) => card.sparkline.length < 2).map((card) => card.instrumentSymbol);
  if (symbols.length === 0) return view;
  const updates = await loadSparklines(symbols);
  if (Object.keys(updates).length === 0) return view;
  return applySparklines(view, updates);
}

export function HomePage({ initialView }: { readonly initialView?: HomeView } = {}) {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [chip, setChip] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState<HomeView | undefined>(initialView);
  const [cache, setCache] = useState<Readonly<Record<string, HomeView>>>(initialView === undefined ? {} : { All: initialView });
  const [error, setError] = useState<string | null>(null);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const category = filter === "All" ? chip : filter;
  const activeKey = categoryKey(filter, chip);
  const requestKey = useRef(activeKey);
  requestKey.current = activeKey;

  const remember = (key: string, next: HomeView) => {
    setCache((current) => ({ ...current, [key]: next }));
    if (requestKey.current === key) setView(next);
  };

  const prefetchCategories = () => {
    void Promise.all(PREFETCH_CATEGORIES.map(async (name) => {
      const prefetched = await loadHome({ sort: "moving", limit: 6, category: name });
      if (prefetched.kind !== "ok") return;
      setCache((current) => (current[name] === undefined ? { ...current, [name]: prefetched.view } : current));
      if (requestKey.current === name) setView(prefetched.view);
      const ready = await fillSparklines(prefetched.view);
      remember(name, ready);
    }));
  };

  usePolling(() => {
    const key = activeKey;
    const queryCategory = category;
    const querySearch = submitted;
    if (key === "All" && querySearch === "") prefetchCategories();
    void loadHome({ sort: "moving", limit: 6, ...(querySearch ? { search: querySearch } : {}), ...(queryCategory ? { category: queryCategory } : {}) }).then(async (result) => {
      if (result.kind !== "ok") {
        if (requestKey.current === key) setError(result.message);
        return;
      }
      setError(null);
      remember(key, result.view);
      const filled = await fillSparklines(result.view);
      remember(key, filled);
    }).catch(() => {
      if (requestKey.current === key) setError("Live markets are unavailable right now.");
    });
  }, POLL_MS + tick);

  const markets = view?.markets ?? [];
  const watchlist = useWatchlist();

  const selectFilter = (name: string) => {
    setFilter(name);
    setChip(undefined);
    const key = categoryKey(name, undefined);
    const cached = cache[key];
    setView(cached);
    setTick((value) => value + 1);
  };

  const selectChip = (name: string) => {
    const next = chip === name ? undefined : name;
    setFilter("All");
    setChip(next);
    const key = categoryKey("All", next);
    const cached = cache[key];
    if (cached !== undefined) setView(cached);
    else setView(undefined);
    setTick((value) => value + 1);
  };

  const onSearch = () => {
    const text = search.trim();
    setMatchMessage(null);
    if (isXUrl(text)) {
      void matchQuery(text).then((result) => {
        if ("error" in result) {
          setMatchMessage(result.error);
          return;
        }
        if (result.kind === "matched") {
          setSubmitted(result.market.eventTitle);
          setMatchMessage(`Matched to ${result.market.eventTitle} (${result.matchedBy}).`);
        } else {
          setMatchMessage(result.reason);
        }
      });
      return;
    }
    setSubmitted(text);
    setView(undefined);
    setTick((value) => value + 1);
  };

  return (
    <div className={styles.page}>
      <section className={styles.ask} aria-label="Ask">
        <h1 className={styles.title}>What do you want to predict?</h1>
        <form className={styles.box} onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <label htmlFor="ask" className={styles.hidden}>Ask about a market</label>
          <input id="ask" className={styles.field} value={search} placeholder="Explore different markets, or paste an X link…" onChange={(event) => { setSearch(event.target.value); }} />
          <div className={styles.tools}>
            <button type="submit" className={styles.submit} aria-label="Search"><SubmitIcon /></button>
          </div>
        </form>
        {matchMessage ? <p className={styles.status}>{matchMessage}</p> : null}
        <div className={styles.chips}>
          {CHIP_CATEGORIES.map((name) => (
            <button
              key={name}
              type="button"
              className={styles.chip}
              aria-pressed={chip === name && filter === "All"}
              onClick={() => { selectChip(name); }}
            >
              {name}
            </button>
          ))}
          <button type="button" className={styles.refresh} aria-label="Refresh markets" onClick={() => { setTick((value) => value + 1); }}>
            <RefreshIcon />
          </button>
        </div>
      </section>

      <section className={styles.moving} aria-label="Moving now">
        <div className={styles.movingHead}>
          <h2 className={styles.movingTitle}>Moving now</h2>
          <div className={styles.filters}>
            {FILTERS.map((name) => (
              <button
                key={name}
                type="button"
                className={styles.filter}
                aria-pressed={filter === name}
                onClick={() => { selectFilter(name); }}
              >
                {name}
              </button>
            ))}
            <Link href="/markets" className={styles.browseLink}>Browse all <ChevronIcon /></Link>
          </div>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {view?.stale === true ? <p className={styles.empty} role="status">Showing recent markets while Gemini cools down.</p> : null}
        {error === null && view === undefined ? (
          <>
            <p className={styles.empty}>Loading live markets…</p>
            <SkeletonGrid />
          </>
        ) : null}
        {error === null && view !== undefined && markets.length === 0 ? <p className={styles.empty}>No live markets match that search right now.</p> : null}
        {markets.length > 0 ? (
          <div className={styles.grid}>
            {markets.map((card) => (
              <MarketCard
                key={card.instrumentSymbol}
                card={card}
                watched={watchlist.starred(card.eventTicker, card.instrumentSymbol)}
                onToggleWatch={() => {
                  void watchlist.toggle({ eventTicker: card.eventTicker, instrumentSymbol: card.instrumentSymbol, yesCents: card.yesCents });
                }}
              />
            ))}
          </div>
        ) : null}
        <div className={styles.footer}>
          <Link href="/markets" className={styles.browseAll}>Browse all markets</Link>
        </div>
      </section>
    </div>
  );
}
