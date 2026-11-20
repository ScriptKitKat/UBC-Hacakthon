"use client";

import Link from "next/link";
import { useState } from "react";
import type { AgentRecordView, AgentsView, WatchlistCard } from "@/shared";
import { friendlyEventTitle } from "@/shared";
import { deleteAgent, loadAgents, runAgent, saveAgent } from "../_shell/api";
import { marketHref } from "../_market-card/model";
import { agentRunResultText } from "../_watchlist/agent-run-result";
import { AgentSetup } from "../_watchlist/agent-setup";
import {
  agentPermissionLine,
  agentSpendLine,
  agentStatusText,
  relativeTime,
} from "../_watchlist/agent-summary";
import styles from "../_watchlist/agents.module.css";

type ActivityTrigger = NonNullable<AgentRecordView["activity"][number]["trigger"]>;

const TRIGGER_LABELS: Readonly<Record<ActivityTrigger, string>> = {
  oddsMove: "Odds move 5+ points in a day",
  volumeSpike: "Volume spikes 2x or more",
  xMentions: "X mentions surge",
  breakingNews: "Breaking news on the topic",
  oddsCross: "Odds cross a level I set",
  endingSoon: "48 hours before it ends",
  briefOddsMove10: "Brief after 10+ point odds move",
  briefMonday: "Monday brief",
  briefEndingSoon: "Brief 48 hours before it ends",
};

const MODEL_LABELS: Readonly<Record<AgentRecordView["model"], string>> = {
  grok: "Grok",
  claude: "Claude",
  other: "Other",
};

export function AgentDetail({
  agent,
  card,
  view,
  now,
  onView,
  onDelete,
}: {
  readonly agent: AgentRecordView | undefined;
  readonly card: WatchlistCard | undefined;
  readonly view: AgentsView | undefined;
  readonly now: Date;
  readonly onView: (view: AgentsView) => void;
  readonly onDelete: (agentId: string, view: AgentsView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

  if (agent === undefined || view === undefined) {
    return <div className={styles.detailEmpty}>Select an agent to see its status and activity.</div>;
  }

  const currentAgent = agent;
  const marketTitle = card === undefined ? agent.eventTicker : friendlyEventTitle(card.eventTitle, card.expiryDate);
  const marketLink = marketHref(agent.eventTicker, agent.instrumentSymbol);
  const activities = [...agent.activity].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const visibleActivities = activities.slice(0, showAllActivity ? 50 : 5);
  const permission = agentPermissionLine(agent, view.desk);
  const modelAvailable = view.models[agent.model].available;

  async function toggleStatus(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await saveAgent({ status: currentAgent.status === "watching" ? "paused" : "watching" }, currentAgent.id);
      if (result === undefined) setError("The agent status could not be changed. Try again.");
      else onView(result);
    } catch {
      setError("The agent status could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(): Promise<void> {
    if (currentAgent.status === "paused" || busy) return;
    setBusy(true);
    setRunResult(null);
    setError(null);
    try {
      const report = await runAgent(currentAgent.id);
      const refreshed = await loadAgents();
      if (refreshed !== undefined) onView(refreshed);
      const tick = report?.ticks.find((item) => item.agentId === currentAgent.id);
      if (tick === undefined) setRunResult("The agent run could not be completed.");
      else setRunResult(agentRunResultText(tick, tick.fired.map((trigger) => TRIGGER_LABELS[trigger])));
    } catch {
      setRunResult("The agent run could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAgent(): Promise<void> {
    if (!window.confirm(`Delete ${currentAgent.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAgent(currentAgent.id);
      if (result === undefined) setError("The agent could not be deleted. Try again.");
      else onDelete(currentAgent.id, result);
    } catch {
      setError("The agent could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <AgentSetup
        key={agent.id}
        mode="edit"
        agent={agent}
        view={view}
        onView={onView}
        onCancel={() => { setEditing(false); }}
        onSaved={() => { setEditing(false); }}
      />
    );
  }

  return (
    <section className={styles.agentDetail} aria-labelledby="agent-detail-title">
      <header className={styles.detailHeader}>
        <div>
          <p className={styles.forLabel}>Agent</p>
          <h2 id="agent-detail-title" className={styles.forTitle}>{agent.name}</h2>
          <p className={styles.detailMarket}>{marketTitle}</p>
        </div>
        <Link className={styles.openMarket} href={marketLink}>Open market</Link>
      </header>

      <div className={styles.statusCard}>
        <div className={styles.statusHeader}>
          <span className={styles.statusPill} data-status={agent.status}>
            {agent.status === "watching" ? "Running" : "Paused"}
          </span>
          <span className={styles.statusText}>{agentStatusText(agent, now)}</span>
        </div>
        <p className={styles.statusText}>{agentSpendLine(agent, now)}</p>
        <p className={styles.permissionText}>
          {permission.text}{permission.portfolioLink ? <>{" "}<Link href="/positions#approvals">Portfolio</Link></> : null}
        </p>
        {!modelAvailable ? (
          <p className={styles.hint}>{MODEL_LABELS[agent.model]} · not configured, using template messages</p>
        ) : null}
      </div>

      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      {runResult === null ? null : <p className={styles.runResult} role="status">{runResult}</p>}
      <div className={styles.detailActions}>
        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => { void toggleStatus(); }}>
          {agent.status === "watching" ? "Pause" : "Resume"}
        </button>
        <button type="button" className={styles.actionButton} disabled={busy || agent.status === "paused"} onClick={() => { void runNow(); }}>
          {busy ? "Running…" : "Run now"}
        </button>
        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => { setEditing(true); }}>
          Edit settings
        </button>
        <button type="button" className={styles.deleteButton} disabled={busy} onClick={() => { void removeAgent(); }}>
          Delete
        </button>
      </div>

      <div className={styles.messageCard}>
        <h3 className={styles.sectionTitle}>Latest message</h3>
        {agent.lastMessage === null ? (
          <p className={styles.preview}>No message yet. The agent writes one when something it watches happens.</p>
        ) : (
          <>
            {agent.lastMessageSource !== null ? (
              <span className={styles.source}>{agent.lastMessageSource === "llm" ? MODEL_LABELS[agent.model] : "Template"}</span>
            ) : null}
            <p className={styles.preview}>{agent.lastMessage}</p>
          </>
        )}
      </div>

      <section className={styles.activity} aria-label="Agent activity">
        <div className={styles.activityHead}>
          <h3 className={styles.sectionTitle}>Activity</h3>
          {activities.length > 5 ? (
            <button
              type="button"
              className={styles.activityToggle}
              onClick={() => { setShowAllActivity((showing) => !showing); }}
            >
              {showAllActivity ? "Show less" : "Show all"}
            </button>
          ) : null}
        </div>
        {visibleActivities.length === 0 ? (
          <p className={styles.activityEmpty}>No activity yet.</p>
        ) : (
          <ol className={styles.activityList}>
            {visibleActivities.map((item) => (
              <li key={item.id} className={styles.activityRow}>
                <div className={styles.activityMeta}>
                  <span className={styles.activityKind} data-kind={item.kind}>{item.kind}</span>
                  <time className={styles.activityTime} dateTime={item.at}>{relativeTime(item.at, now)}</time>
                </div>
                <p className={styles.activityText}>
                  {item.text}
                  {item.kind === "suggestion" ? (
                    <>{" "}<Link className={styles.activityLink} href="/positions#approvals">Approve in Portfolio</Link></>
                  ) : null}
                  {item.url === undefined ? null : (
                    <>{" "}<a className={styles.activityLink} href={item.url} target="_blank" rel="noreferrer">View on X</a></>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
