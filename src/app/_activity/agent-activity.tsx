"use client";

import { useState } from "react";
import type { AgentFeedItem } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadAgentActivity } from "../_shell/api";
import styles from "./agent-activity.module.css";

const POLL_MS = 15_000;

function kindLabel(kind: AgentFeedItem["kind"]): string {
  switch (kind) {
    case "message": return "Message";
    case "suggestion": return "Suggestion";
    case "bet": return "Bet";
    case "brief": return "Brief";
    case "pause": return "Paused";
    case "resume": return "Resumed";
    case "refused": return "Held back";
    default: return kind;
  }
}

function when(at: string): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function AgentActivity({ initial }: { readonly initial?: readonly AgentFeedItem[] } = {}) {
  const [items, setItems] = useState<readonly AgentFeedItem[]>(initial ?? []);
  const [loaded, setLoaded] = useState(initial !== undefined);

  usePolling(() => {
    void loadAgentActivity().then((result) => {
      if (result !== undefined) setItems(result.activity);
      setLoaded(true);
    });
  }, POLL_MS);

  return (
    <section className={styles.panel} aria-label="Agent activity">
      <div className={styles.head}>
        <h2 className={styles.title}>Agent activity</h2>
        <p className={styles.lead}>Messages, suggestions, bets, and briefs from watchlist agents.</p>
      </div>
      {!loaded ? <p className={styles.empty}>Loading agent activity…</p> : null}
      {loaded && items.length === 0 ? <p className={styles.empty}>No agent activity yet. When a watching agent sees a move, it will show up here.</p> : null}
      {items.length > 0 ? (
        <ol className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.kind} data-kind={item.kind}>{kindLabel(item.kind)}</span>
                <span>{item.agentName}</span>
                <span>{item.eventTicker}</span>
                <span>{when(item.at)}</span>
                {item.messageSource === "template" ? <span>template</span> : null}
                {item.messageSource === "llm" ? <span>Grok</span> : null}
              </div>
              <p className={styles.text}>{item.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
