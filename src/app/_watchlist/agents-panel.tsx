"use client";

import Link from "next/link";
import type { AgentRecordView, AgentsView, WatchlistCard } from "@/shared";
import { MarketCard } from "../_market-card/market-card";
import { watchlistCardModel } from "../_market-card/model";
import { useViewMode } from "../_research/use-view-mode";
import { AgentSetup } from "./agent-setup";
import styles from "./agents.module.css";

export function agentFor(agents: readonly AgentRecordView[], ticker: string): AgentRecordView | undefined {
  return agents.find((agent) => agent.eventTicker === ticker);
}

export function statusLine(agent: AgentRecordView): string {
  return `Agent ${agent.name} · ${agent.status === "watching" ? "running" : "paused"} — View`;
}

export function AgentsPanel({
  cards,
  view,
  selectedTicker,
  onSelect,
  onView,
  onCreated,
  onSwitchMarkets,
}: {
  readonly cards: readonly WatchlistCard[];
  readonly view: AgentsView | undefined;
  readonly selectedTicker: string | null;
  readonly onSelect: (ticker: string) => void;
  readonly onView: (view: AgentsView) => void;
  readonly onCreated: (view: AgentsView, agentId: string) => void;
  readonly onSwitchMarkets: () => void;
}) {
  const [mode] = useViewMode();
  const beginner = mode === "beginner";
  const agents = view?.agents ?? [];
  const selectedCard = cards.find((card) => card.eventTicker === selectedTicker) ?? cards[0];
  const selectedAgent = selectedCard === undefined ? undefined : agentFor(agents, selectedCard.eventTicker);

  return (
    <section className={styles.panel} aria-label="Create an agent">
      <div className={styles.setupLayout}>
        <section className={styles.marketChooser} aria-labelledby="market-chooser-title">
          <h2 id="market-chooser-title" className={styles.sectionTitle}>Choose a saved market</h2>
          {cards.length === 0 ? (
            <div className={styles.noMarkets}>
              <strong>Save a market first</strong>
              <span>Saved markets are available here when you are ready to create an agent.</span>
              <button type="button" className={styles.actionButton} onClick={onSwitchMarkets}>Saved markets</button>
            </div>
          ) : (
            <div className={styles.marketChoices}>
              {cards.map((card) => {
                const agent = agentFor(agents, card.eventTicker);
                return (
                  <MarketCard
                    key={card.eventTicker}
                    model={watchlistCardModel(card, beginner)}
                    selected={selectedCard?.eventTicker === card.eventTicker}
                    onSelect={() => { onSelect(card.eventTicker); }}
                    footStart={agent === undefined
                      ? <span className={styles.marketAgentNone}>No agent yet</span>
                      : (
                        <Link
                          className={styles.marketAgentLink}
                          href={`/agents?agent=${encodeURIComponent(agent.id)}`}
                          onClick={(event) => { event.stopPropagation(); }}
                        >
                          {statusLine(agent)}
                        </Link>
                      )}
                  />
                );
              })}
            </div>
          )}
        </section>

        {cards.length === 0 ? null : selectedCard === undefined ? null : view === undefined ? (
          <div className={styles.detailEmpty}>Loading agent setup…</div>
        ) : selectedAgent !== undefined ? (
          <div className={styles.noMarkets}>
            <strong>This market already has an agent</strong>
            <span>Open its status and activity from Your agents.</span>
            <Link
              className={styles.marketAgentLink}
              href={`/agents?agent=${encodeURIComponent(selectedAgent.id)}`}
              onClick={(event) => { event.stopPropagation(); }}
            >
              View {selectedAgent.name}
            </Link>
          </div>
        ) : (
          <AgentSetup
            key={selectedCard.eventTicker}
            mode="create"
            card={selectedCard}
            view={view}
            onView={onView}
            onCreated={onCreated}
          />
        )}
      </div>
    </section>
  );
}
