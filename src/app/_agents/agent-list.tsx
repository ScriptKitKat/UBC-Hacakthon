"use client";

import type { AgentRecordView, WatchlistCard } from "@/shared";
import { friendlyEventTitle } from "@/shared";
import { agentSpendLine, lastCheckText } from "../_watchlist/agent-summary";
import styles from "../_watchlist/agents.module.css";

const PERMISSION_LABELS: Readonly<Record<AgentRecordView["permission"], string>> = {
  watch: "Watch and tell me",
  suggest: "Suggest bets, I approve",
  autonomous: "Bet on its own within limits",
};

export function AgentList({
  agents,
  cards,
  selectedAgentId,
  now,
  onSelect,
}: {
  readonly agents: readonly AgentRecordView[];
  readonly cards: readonly WatchlistCard[];
  readonly selectedAgentId: string | null;
  readonly now: Date;
  readonly onSelect: (agentId: string) => void;
}) {
  return (
    <div className={styles.agentRows} aria-label="Your agents">
      {agents.map((agent) => {
        const card = cards.find((item) => item.eventTicker === agent.eventTicker);
        const marketTitle = card === undefined ? agent.eventTicker : friendlyEventTitle(card.eventTitle, card.expiryDate);
        const newestActivity = [...agent.activity].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
        return (
          <button
            key={agent.id}
            type="button"
            className={styles.agentRow}
            aria-pressed={agent.id === selectedAgentId}
            onClick={() => { onSelect(agent.id); }}
          >
            <span className={styles.agentRowHead}>
              <strong className={styles.agentRowName}>{agent.name}</strong>
              <span className={styles.statusPill} data-status={agent.status}>
                {agent.status === "watching" ? "Running" : "Paused"}
              </span>
            </span>
            <span className={styles.agentRowMarket}>{marketTitle}</span>
            <span className={styles.agentRowPermission}>{PERMISSION_LABELS[agent.permission]}</span>
            <span className={styles.agentRowSpend}>{agentSpendLine(agent, now)}</span>
            <span className={styles.agentRowCheck}>{lastCheckText(agent, now)}</span>
            <span className={styles.agentRowActivity}>{newestActivity?.text ?? "No activity yet."}</span>
          </button>
        );
      })}
    </div>
  );
}
