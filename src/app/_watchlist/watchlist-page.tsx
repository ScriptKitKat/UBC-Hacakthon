"use client";

import { useState } from "react";
import type { CatalogCard } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { MarketCard } from "../_home/market-card";
import styles from "../_home/home.module.css";
import { changeWatchlist, loadWatchlistCards } from "../_shell/api";

const POLL_MS = 30_000;

export function WatchlistPage() {
  const [symbols, setSymbols] = useState<readonly string[] | undefined>(undefined);
  const [cards, setCards] = useState<readonly CatalogCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  usePolling(() => {
    void loadWatchlistCards().then((result) => {
      if (result === undefined) {
        setError("The watchlist could not be loaded.");
        return;
      }
      setSymbols(result.symbols);
      setCards(result.cards);
      setError(null);
    });
  }, POLL_MS);

  const missing = (symbols ?? []).filter((symbol) => !cards.some((card) => card.instrumentSymbol === symbol));

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Watchlist</h1>
      <p className={styles.pageLead}>Markets you saved on this desk. They are stored locally in the desk data directory, not a sample list.</p>
      <div className={styles.moving}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {error === null && symbols === undefined ? <p className={styles.empty}>Loading your watchlist…</p> : null}
        {error === null && symbols !== undefined && symbols.length === 0 ? (
          <p className={styles.empty}>You have not saved any markets yet. Open Markets and use Watch under a card.</p>
        ) : null}
        {cards.length > 0 ? (
          <div className={styles.grid}>
            {cards.map((card) => (
              <MarketCard
                key={card.instrumentSymbol}
                card={card}
                watched
                onToggleWatch={() => {
                  void changeWatchlist(card.instrumentSymbol, "remove").then((next) => {
                    setSymbols(next);
                    setCards((current) => current.filter((item) => item.instrumentSymbol !== card.instrumentSymbol));
                  });
                }}
              />
            ))}
          </div>
        ) : null}
        {missing.length > 0 ? (
          <p className={styles.empty}>Saved but not in the live catalog right now: {missing.join(", ")}</p>
        ) : null}
      </div>
    </div>
  );
}
