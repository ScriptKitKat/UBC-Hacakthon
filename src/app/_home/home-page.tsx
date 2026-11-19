"use client";

import Link from "next/link";
import { useState } from "react";
import { isXUrl } from "@/shared";
import type { HomeView } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadHome, matchQuery } from "../_shell/api";
import { ChevronIcon, MicIcon, RefreshIcon, SubmitIcon } from "../_shell/icons";
import { MarketCard } from "./market-card";
import styles from "./home.module.css";

const CHIP_CATEGORIES = ["Crypto", "Sports", "Politics", "Economy"] as const;
const FILTERS = ["All", "Crypto", "Sports", "Politics"] as const;
const POLL_MS = 30_000;

export function HomePage() {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [chip, setChip] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState<HomeView | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const category = filter === "All" ? chip : filter;
  usePolling(() => {
    void loadHome({ sort: "moving", limit: 6, ...(submitted ? { search: submitted } : {}), ...(category ? { category } : {}) }).then((result) => {
      if (result.kind === "ok") {
        setView(result.view);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }, POLL_MS + tick);

  const pending = view?.rail.pendingCount ?? 0;
  const markets = view?.markets ?? [];

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
    setTick((value) => value + 1);
  };

  return (
    <div className={styles.page}>
      <section className={styles.ask} aria-label="Ask">
        {pending > 0 ? (
          <Link href="/activity#approvals" className={styles.pending}>
            <span className={styles.dot} aria-hidden="true" />
            <span><span className={styles.pendingCount}>{pending === 1 ? "1 bet" : `${String(pending)} bets`}</span> {pending === 1 ? "is" : "are"} waiting for your OK</span>
            <ChevronIcon />
          </Link>
        ) : null}
        <h1 className={styles.title}>What do you want to predict?</h1>
        <form className={styles.box} onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <label htmlFor="ask" className={styles.hidden}>Ask about a market</label>
          <input id="ask" className={styles.field} value={search} placeholder="Explore different markets, or paste an X link…" onChange={(event) => { setSearch(event.target.value); }} />
          <div className={styles.tools}>
            <Link href="/activity#voice" className={styles.iconButton} aria-label="Ask by voice"><MicIcon /></Link>
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
              onClick={() => { setFilter("All"); setChip((current) => current === name ? undefined : name); setTick((value) => value + 1); }}
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
                onClick={() => { setFilter(name); if (name !== "All") setChip(undefined); setTick((value) => value + 1); }}
              >
                {name}
              </button>
            ))}
            <Link href="/markets" className={styles.browseLink}>Browse all <ChevronIcon /></Link>
          </div>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {error === null && view === undefined ? <p className={styles.empty}>Loading live markets…</p> : null}
        {error === null && view !== undefined && markets.length === 0 ? <p className={styles.empty}>No live markets match that search right now.</p> : null}
        {markets.length > 0 ? (
          <div className={styles.grid}>
            {markets.map((card) => (
              <MarketCard key={card.instrumentSymbol} card={card} />
            ))}
          </div>
        ) : null}
        <div className={styles.footer}>
          <Link href="/markets" className={styles.browseAll}>Browse all markets</Link>
          <Link href="/activity" className={styles.activityLink}>Desk activity, voice, and approvals</Link>
        </div>
      </section>
    </div>
  );
}
