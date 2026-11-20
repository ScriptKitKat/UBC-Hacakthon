"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentsView, WatchlistCard, WatchlistView } from "@/shared";
import { formatBudgetCents } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadAgents, loadWatchlistCards } from "../_shell/api";
import { PageHero } from "../_shell/page-hero";
import { AgentsPanel } from "./agents-panel";
import { MarketCard, MarketCardGrid } from "../_market-card/market-card";
import { watchlistCardModel } from "../_market-card/model";
import { useViewMode } from "../_research/use-view-mode";
import {
  filterWatchlist,
  sortWatchlist,
  type WatchlistFilter,
  type WatchlistSort,
} from "./query";
import { useWatchlist } from "./use-watchlist";
import styles from "./watchlist.module.css";

const POLL_MS = 30_000;
const FILTERS: readonly { value: WatchlistFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "moving", label: "Moving" },
  { value: "closing", label: "Closing soon" },
  { value: "agent", label: "With an agent" },
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

export function WatchlistPage({
  initialView,
  initialTab = "markets",
  initialMarket = null,
}: {
  readonly initialView?: WatchlistView;
  readonly initialTab?: "markets" | "agents";
  readonly initialMarket?: string | null;
} = {}) {
  const router = useRouter();
  const watchlist = useWatchlist(initialView?.symbols ?? []);
  const [mode] = useViewMode();
  const beginner = mode === "beginner";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WatchlistFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("move");
  const [cards, setCards] = useState<readonly WatchlistCard[]>(initialView?.cards ?? []);
  const [agentsView, setAgentsView] = useState<AgentsView | undefined>(undefined);
  const [tab, setTab] = useState<"markets" | "agents">(initialTab);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(initialMarket);
  const [loaded, setLoaded] = useState(initialView !== undefined);
  const [error, setError] = useState<string | null>(null);

  function syncUrl(nextTab: "markets" | "agents", market: string | null) {
    const params = new URLSearchParams();
    if (nextTab === "agents") params.set("tab", "agents");
    if (market) params.set("market", market);
    const query = params.toString();
    router.replace(query === "" ? "/watchlist" : `/watchlist?${query}`, { scroll: false });
  }

  function openAgents(ticker: string | null) {
    setTab("agents");
    setSelectedTicker(ticker);
    syncUrl("agents", ticker);
  }

  usePolling(() => {
    void Promise.all([loadWatchlistCards(), loadAgents()]).then(([result, agents]) => {
      if (result === undefined) {
        setError("The watchlist could not be loaded.");
        setLoaded(true);
        return;
      }
      setCards(result.cards ?? []);
      if (agents !== undefined) setAgentsView(agents);
      setError(null);
      setLoaded(true);
    });
  }, POLL_MS);

  const visibleCards = cards.filter((card) => watchlist.starred(card.eventTicker, card.instrumentSymbol));
  const agentTickers = new Set((agentsView?.agents ?? []).map((agent) => agent.eventTicker));
  const shown = sortWatchlist(filterWatchlist(visibleCards, { filter, search, agentTickers }), sort);
  const savedCount = visibleCards.length;
  const watching = (agentsView?.agents ?? []).filter((agent) => agent.status === "watching").length;
  const paused = (agentsView?.agents ?? []).filter((agent) => agent.status === "paused").length;
  const agentCount = agentsView?.agents.length ?? 0;
  const assigned = agentsView?.assignedCents ?? 0;
  const cap = agentsView?.desk.dailyCapCents ?? 0;

  return (
    <div className={styles.page}>
      <PageHero
        title="Watchlist"
        lead={tab === "markets"
          ? `${savedCount === 1 ? "1 saved market" : `${String(savedCount)} saved markets`} · ${String(watching)} ${watching === 1 ? "agent" : "agents"} watching · ${String(paused)} paused`
          : `${String(watching)} ${watching === 1 ? "agent" : "agents"} running · ${formatBudgetCents(assigned)} of ${formatBudgetCents(cap)} daily budget assigned`}
      >
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); }}>
            <label htmlFor="wsearch" className={styles.hidden}>Search saved markets</label>
            <SearchIcon />
            <input id="wsearch" value={search} placeholder="Search saved markets" onChange={(event) => { setSearch(event.target.value); }} />
          </form>
      </PageHero>
      <div className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Watchlist sections">
          <button type="button" role="tab" className={styles.tab} aria-selected={tab === "markets"} onClick={() => { setTab("markets"); syncUrl("markets", selectedTicker); }}>
            Saved markets
          </button>
          <button type="button" role="tab" className={styles.tab} aria-selected={tab === "agents"} onClick={() => { openAgents(selectedTicker ?? visibleCards[0]?.eventTicker ?? null); }}>
            Agents{agentCount > 0 ? ` ${String(agentCount)}` : ""}
          </button>
        </div>
        {tab === "markets" ? (
          <button
            type="button"
            className={styles.create}
            onClick={() => {
              const open = visibleCards.find((card) => !agentTickers.has(card.eventTicker)) ?? visibleCards[0];
              openAgents(open?.eventTicker ?? null);
            }}
          >
            Create an agent
          </button>
        ) : null}
      </div>

      <div className={styles.body}>
        {tab === "markets" ? (
          <>
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
                <strong className={styles.emptyTitle}>Nothing saved yet</strong>
                <span>Save markets you want to keep an eye on before deciding anything. On Markets, tap the star on a card to add it here.</span>
                <Link href="/markets" className={styles.emptyLink}>Browse markets</Link>
              </div>
            ) : null}
            {error === null && savedCount > 0 && shown.length === 0 ? (
              <p className={styles.status}>No saved markets match that search right now.</p>
            ) : null}
            {shown.length > 0 ? (
              <MarketCardGrid>
                {shown.map((card) => {
                  return (
                    <MarketCard
                      key={card.eventTicker}
                      model={watchlistCardModel(card, beginner)}
                      watch={{
                        pressed: true,
                        label: "Remove from watchlist",
                        onToggle: () => {
                          void watchlist.toggle({ eventTicker: card.eventTicker, instrumentSymbol: card.instrumentSymbol, yesCents: card.yesCents });
                        },
                      }}
                    />
                  );
                })}
              </MarketCardGrid>
            ) : null}
          </>
        ) : (
          <AgentsPanel
            cards={visibleCards}
            view={agentsView}
            selectedTicker={selectedTicker ?? visibleCards[0]?.eventTicker ?? null}
            onSelect={(ticker) => { setSelectedTicker(ticker); syncUrl("agents", ticker); }}
            onView={setAgentsView}
          />
        )}
      </div>
    </div>
  );
}
