"use client";

import { useState } from "react";
import type { HomeView } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { MarketCard } from "../_home/market-card";
import styles from "../_home/home.module.css";
import { changeWatchlist, loadHome, loadWatchlist } from "../_shell/api";

const POLL_MS = 30_000;

export function BrowsePage() {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [view, setView] = useState<HomeView | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState<readonly string[]>([]);
  const [tick, setTick] = useState(0);

  usePolling(() => {
    void loadHome({ sort: "default", limit: 24, ...(submitted ? { search: submitted } : {}) }).then((result) => {
      if (result.kind === "ok") {
        setView(result.view);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    void loadWatchlist().then(setWatched);
  }, POLL_MS + tick);

  const markets = view?.markets ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Markets</h1>
      <p className={styles.pageLead}>Live Gemini prediction markets, not a sample list. Open a card to research and trade.</p>
      <form className={styles.searchRow} onSubmit={(event) => { event.preventDefault(); setSubmitted(search.trim()); setTick((value) => value + 1); }}>
        <input value={search} placeholder="Search live markets" onChange={(event) => { setSearch(event.target.value); }} aria-label="Search markets" />
        <button type="submit">Search</button>
      </form>
      <div className={styles.moving}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {error === null && view === undefined ? <p className={styles.empty}>Loading live markets…</p> : null}
        {error === null && view !== undefined && markets.length === 0 ? <p className={styles.empty}>No live markets match that search right now.</p> : null}
        {markets.length > 0 ? (
          <div className={styles.grid}>
            {markets.map((card) => (
              <MarketCard
                key={card.instrumentSymbol}
                card={card}
                watched={watched.includes(card.instrumentSymbol)}
                onToggleWatch={() => {
                  const action = watched.includes(card.instrumentSymbol) ? "remove" : "add";
                  void changeWatchlist(card.instrumentSymbol, action).then(setWatched);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
