"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { AgentsView, WatchlistCard } from "@/shared";
import { formatBudgetCents } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadAgents, loadWatchlistCards } from "../_shell/api";
import { PageHero } from "../_shell/page-hero";
import { AgentDetail } from "./agent-detail";
import { AgentList } from "./agent-list";
import styles from "./agents.module.css";
import watchlistStyles from "../_watchlist/agents.module.css";

const POLL_MS = 30_000;

export function AgentsPage({ initialAgentId = null }: { readonly initialAgentId?: string | null }) {
  const router = useRouter();
  const [view, setView] = useState<AgentsView | undefined>(undefined);
  const [cards, setCards] = useState<readonly WatchlistCard[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialAgentId);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedAgentIdRef = useRef(initialAgentId);

  const selectAgent = useCallback((agentId: string) => {
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    router.replace(`/agents?agent=${encodeURIComponent(agentId)}`, { scroll: false });
  }, [router]);

  usePolling(() => {
    void Promise.all([loadAgents(), loadWatchlistCards()])
      .then(([agents, marketResult]) => {
        if (agents === undefined) {
          setError("Your agents could not be loaded.");
          setLoaded(true);
          return;
        }
        setView(agents);
        if (marketResult !== undefined) setCards(marketResult.cards ?? []);
        const currentId = selectedAgentIdRef.current;
        const selected = agents.agents.find((agent) => agent.id === currentId);
        if (selected === undefined) {
          const nextAgent = agents.agents[0];
          if (nextAgent === undefined) {
            selectedAgentIdRef.current = null;
            setSelectedAgentId(null);
            if (currentId !== null) router.replace("/agents", { scroll: false });
          } else {
            selectedAgentIdRef.current = nextAgent.id;
            setSelectedAgentId(nextAgent.id);
            router.replace(`/agents?agent=${encodeURIComponent(nextAgent.id)}`, { scroll: false });
          }
        }
        setError(null);
        setLoaded(true);
      })
      .catch(() => {
        setError("Your agents could not be loaded.");
        setLoaded(true);
      });
  }, POLL_MS);

  function handleDelete(agentId: string, nextView: AgentsView): void {
    setView(nextView);
    if (selectedAgentId !== agentId) return;
    const nextAgent = nextView.agents[0];
    if (nextAgent === undefined) {
      selectedAgentIdRef.current = null;
      setSelectedAgentId(null);
      router.replace("/agents", { scroll: false });
      return;
    }
    selectAgent(nextAgent.id);
  }

  const agents = view?.agents ?? [];
  const running = agents.filter((agent) => agent.status === "watching").length;
  const assigned = view?.assignedCents ?? 0;
  const cap = view?.desk.dailyCapCents ?? 0;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div className={styles.page}>
      <PageHero
        title="Your agents"
        lead={`${String(running)} running · ${formatBudgetCents(assigned)} of ${formatBudgetCents(cap)} daily budget assigned`}
      />
      {error === null && !loaded ? <p className={styles.status}>Loading your agents…</p> : null}
      {error !== null ? <p className={styles.error} role="alert">{error}</p> : null}
      {error === null && loaded && agents.length === 0 ? (
        <div className={styles.empty}>
          <h2>No agents yet</h2>
          <p>Choose a saved market to set up an agent that watches it for you.</p>
          <Link className={styles.emptyLink} href="/watchlist?tab=agents">Create an agent</Link>
        </div>
      ) : null}
      {view !== undefined && agents.length > 0 ? (
        <div className={styles.body}>
          <section className={styles.listPane} aria-labelledby="agents-list-title">
            <h2 id="agents-list-title" className={watchlistStyles.sectionTitle}>Your agents</h2>
            <AgentList
              agents={agents}
              cards={cards}
              selectedAgentId={selectedAgent?.id ?? null}
              now={new Date()}
              onSelect={selectAgent}
            />
          </section>
          <AgentDetail
            key={selectedAgent?.id ?? "empty"}
            agent={selectedAgent}
            card={cards.find((card) => card.eventTicker === selectedAgent?.eventTicker)}
            view={view}
            now={new Date()}
            onView={setView}
            onDelete={handleDelete}
          />
        </div>
      ) : null}
    </div>
  );
}
