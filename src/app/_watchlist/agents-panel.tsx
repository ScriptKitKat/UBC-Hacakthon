"use client";

import Link from "next/link";
import { useState } from "react";
import type { AgentRecordView, AgentsView, WatchlistCard } from "@/shared";
import { formatBudgetCents, friendlyEventTitle } from "@/shared";
import { MarketCard } from "../_market-card/market-card";
import { watchlistCardModel } from "../_market-card/model";
import { useViewMode } from "../_research/use-view-mode";
import { deleteAgent, loadAgents, runAgent, saveAgent } from "../_shell/api";
import { agentRunResultText } from "./agent-run-result";
import styles from "./agents.module.css";

const MODELS: readonly { value: AgentRecordView["model"]; label: string }[] = [
  { value: "grok", label: "Grok" },
  { value: "claude", label: "Claude" },
  { value: "other", label: "Other" },
];

const PERSONALITIES: readonly { value: AgentRecordView["personality"]; label: string; blurb: string }[] = [
  { value: "calm", label: "Calm analyst", blurb: "Measured, cites numbers, flags risk first" },
  { value: "contrarian", label: "Contrarian", blurb: "Pushes back on crowd hype" },
  { value: "momentum", label: "Momentum hunter", blurb: "Looks for moves backed by volume" },
  { value: "coach", label: "Plain-English coach", blurb: "Explains everything, no jargon" },
];

const WATCHES: readonly { key: Exclude<keyof AgentRecordView["triggers"], "oddsCrossLevel">; label: string; note?: string }[] = [
  { key: "oddsMove", label: "Odds move 5+ points in a day" },
  { key: "volumeSpike", label: "Volume spikes 2x or more" },
  { key: "xMentions", label: "X mentions surge", note: "needs X feed" },
  { key: "breakingNews", label: "Breaking news on the topic", note: "needs X feed" },
  { key: "oddsCross", label: "Odds cross a level I set" },
  { key: "endingSoon", label: "48 hours before it ends" },
];

const BRIEF_WATCHES: readonly { key: keyof AgentRecordView["briefTriggers"]; label: string }[] = [
  { key: "oddsMove10", label: "When odds move 10+ points" },
  { key: "everyMonday", label: "Every Monday" },
  { key: "endingSoon", label: "48 hours before it ends" },
];

const PERMISSIONS: readonly { value: AgentRecordView["permission"]; label: string }[] = [
  { value: "watch", label: "Watch and tell me" },
  { value: "suggest", label: "Suggest bets, I approve" },
  { value: "autonomous", label: "Bet on its own within limits" },
];

const BETS: readonly AgentRecordView["maxPerBetCents"][] = [100, 200, 500];

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

function relativeTime(at: string): string {
  const elapsedMs = Date.now() - Date.parse(at);
  if (!Number.isFinite(elapsedMs)) return "Unknown time";
  if (elapsedMs < 45_000) return "just now";
  if (elapsedMs < 60 * 60_000) return `${String(Math.floor(elapsedMs / 60_000))}m ago`;
  if (elapsedMs < 24 * 60 * 60_000) return `${String(Math.floor(elapsedMs / (60 * 60_000)))}h ago`;
  if (elapsedMs < 7 * 24 * 60 * 60_000) return `${String(Math.floor(elapsedMs / (24 * 60 * 60_000)))}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function agentFor(agents: readonly AgentRecordView[], ticker: string): AgentRecordView | undefined {
  return agents.find((agent) => agent.eventTicker === ticker);
}

function statusLine(agent: AgentRecordView | undefined): { readonly text: string; readonly status: "watching" | "paused" | "none" } {
  if (agent === undefined) return { text: "+ Add an agent", status: "none" };
  return { text: `Agent ${agent.name} · ${agent.status}`, status: agent.status };
}

export function AgentsPanel({
  cards,
  view,
  selectedTicker,
  onSelect,
  onView,
}: {
  readonly cards: readonly WatchlistCard[];
  readonly view: AgentsView | undefined;
  readonly selectedTicker: string | null;
  readonly onSelect: (ticker: string) => void;
  readonly onView: (view: AgentsView) => void;
}) {
  const agents = view?.agents ?? [];
  const [mode] = useViewMode();
  const beginner = mode === "beginner";
  const selectedCard = cards.find((card) => card.eventTicker === selectedTicker) ?? cards[0];
  const selected = selectedCard === undefined ? undefined : agentFor(agents, selectedCard.eventTicker);
  const maxBudget = Math.max(100, view?.desk.dailyCapCents ?? 2000);

  if (cards.length === 0) {
    return <div className={styles.empty}>Save a market first, then you can assign an agent to watch it.</div>;
  }

  return (
    <div className={styles.layout}>
      <div className={styles.list}>
        {cards.map((card) => {
          const line = statusLine(agentFor(agents, card.eventTicker));
          const isSelected = selectedCard?.eventTicker === card.eventTicker;
          return (
            <MarketCard
              key={card.eventTicker}
              model={watchlistCardModel(card, beginner)}
              selected={isSelected}
              footStart={(
                <button
                  type="button"
                  className={styles.agentLine}
                  data-status={line.status}
                  aria-pressed={isSelected}
                  onClick={() => { onSelect(card.eventTicker); }}
                >
                  {line.text}
                </button>
              )}
            />
          );
        })}
      </div>
      {selectedCard !== undefined ? (
        <AgentEditor
          key={selected?.id ?? selectedCard.eventTicker}
          card={selectedCard}
          agent={selected}
          view={view}
          maxBudget={maxBudget}
          onView={onView}
        />
      ) : null}
    </div>
  );
}

function AgentEditor({
  card,
  agent,
  view,
  maxBudget,
  onView,
}: {
  readonly card: WatchlistCard;
  readonly agent: AgentRecordView | undefined;
  readonly view: AgentsView | undefined;
  readonly maxBudget: number;
  readonly onView: (view: AgentsView) => void;
}) {
  const title = friendlyEventTitle(card.eventTitle, card.expiryDate);
  const [name, setName] = useState(agent?.name ?? "Scout");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [customOpen, setCustomOpen] = useState((agent?.instructions ?? "").trim() !== "");
  const [busy, setBusy] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const models = view?.models;
  const currentId = agent?.id;

  async function persist(input: Record<string, unknown>, id = currentId): Promise<void> {
    setBusy(true);
    const result = id === undefined
      ? await saveAgent({ eventTicker: card.eventTicker, instrumentSymbol: card.instrumentSymbol, name, ...input })
      : await saveAgent(input, id);
    if (result !== undefined) onView(result);
    setBusy(false);
  }

  async function runNow(): Promise<void> {
    if (agent === undefined || agent.status === "paused" || busy) return;
    setBusy(true);
    setRunResult(null);
    try {
      const report = await runAgent(agent.id);
      const refreshed = await loadAgents();
      if (refreshed !== undefined) onView(refreshed);
      const tick = report?.ticks.find((item) => item.agentId === agent.id);
      if (tick === undefined) {
        setRunResult("The agent run could not be completed.");
      } else {
        setRunResult(agentRunResultText(tick, tick.fired.map((trigger) => TRIGGER_LABELS[trigger])));
      }
    } catch {
      setRunResult("The agent run could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const draft: AgentRecordView["triggers"] = agent?.triggers ?? {
    oddsMove: true,
    volumeSpike: true,
    xMentions: false,
    breakingNews: false,
    oddsCross: false,
    oddsCrossLevel: 50,
    endingSoon: true,
  };
  const briefs = agent?.briefTriggers ?? { oddsMove10: true, everyMonday: false, endingSoon: true };
  const budget = agent?.dailyBudgetCents ?? Math.min(300, maxBudget);
  const activities = [...(agent?.activity ?? [])].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const visibleActivities = activities.slice(0, showAllActivity ? 50 : 5);

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <div>
          <p className={styles.forLabel}>Agent for</p>
          <h2 className={styles.forTitle}>{title}</h2>
        </div>
        {agent === undefined ? null : (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.badge}
              data-status={agent.status}
              disabled={busy}
              onClick={() => { void persist({ status: agent.status === "watching" ? "paused" : "watching" }); }}
            >
              {agent.status === "watching" ? "Watching" : "Paused"}
            </button>
            <button
              type="button"
              className={styles.runNow}
              disabled={busy || agent.status === "paused"}
              onClick={() => { void runNow(); }}
            >
              Run now
            </button>
          </div>
        )}
      </div>
      {runResult === null ? null : <p className={styles.runResult} role="status">{runResult}</p>}

      {agent === undefined ? (
        <button type="button" className={styles.seg} disabled={busy} onClick={() => { void persist({ name }); }}>
          Create an agent for this market
        </button>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          className={styles.input}
          value={name}
          disabled={busy}
          onChange={(event) => { setName(event.target.value); }}
          onBlur={() => { if (agent !== undefined && name.trim() !== "" && name.trim() !== agent.name) void persist({ name: name.trim() }); }}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.label}>Model</span>
        <div className={styles.segment}>
          {MODELS.map((model) => {
            const available = model.value === "grok" || (models?.[model.value].available ?? false);
            return (
              <button
                key={model.value}
                type="button"
                className={styles.seg}
                aria-pressed={(agent?.model ?? "grok") === model.value}
                disabled={!available || busy || agent === undefined}
                onClick={() => { void persist({ model: model.value }); }}
              >
                {available ? model.label : `${model.label} · not configured`}
              </button>
            );
          })}
        </div>
        {models?.grok.available === false ? <span className={styles.hint}>Grok will use a template message until it is configured.</span> : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Personality</span>
        <div className={styles.segment}>
          {PERSONALITIES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.preset}
              aria-pressed={(agent?.personality ?? "calm") === item.value}
              disabled={busy || agent === undefined}
              title={item.blurb}
              onClick={() => { void persist({ personality: item.value }); }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.preset}
            aria-pressed={customOpen}
            disabled={busy || agent === undefined}
            onClick={() => { setCustomOpen((open) => !open); }}
          >
            Your own instructions
          </button>
        </div>
        <span className={styles.hint}>{PERSONALITIES.find((item) => item.value === (agent?.personality ?? "calm"))?.blurb}</span>
        {customOpen ? (
          <textarea
            className={styles.textarea}
            value={instructions}
            disabled={busy || agent === undefined}
            placeholder="Add your own instructions"
            onChange={(event) => { setInstructions(event.target.value); }}
            onBlur={() => { if (agent !== undefined && instructions !== agent.instructions) void persist({ instructions }); }}
          />
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Latest message</span>
        {agent?.lastMessage ? (
          <>
            {agent.lastMessageSource !== null ? <span className={styles.source}>{agent.lastMessageSource === "llm" ? "Grok" : "Template"}</span> : null}
            <p className={styles.preview}>{agent.lastMessage}</p>
          </>
        ) : (
          <p className={styles.preview}>No message yet. The agent writes one when something it watches happens.</p>
        )}
        <div className={styles.activity}>
          <div className={styles.activityHead}>
            <span className={styles.label}>Activity</span>
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
                    <time className={styles.activityTime} dateTime={item.at}>{relativeTime(item.at)}</time>
                  </div>
                  <p className={styles.activityText}>
                    {item.text}
                    {item.kind === "suggestion" ? (
                      <>{" "}<Link className={styles.activityLink} href="/positions#approvals">Approve in Portfolio</Link></>
                    ) : null}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>What to watch</span>
        <div className={styles.checks}>
          {WATCHES.map((item) => (
            <div key={item.key}>
              <button
                type="button"
                className={styles.check}
                aria-pressed={draft[item.key]}
                disabled={busy || agent === undefined}
                onClick={() => {
                  const next = { ...draft, [item.key]: !draft[item.key] };
                  if (item.key === "oddsCross" && next.oddsCross && next.oddsCrossLevel === null) next.oddsCrossLevel = 50;
                  void persist({ triggers: next });
                }}
              >
                {item.label}{item.note ? ` · ${item.note}` : ""}
              </button>
              {item.key === "oddsCross" && draft.oddsCross ? (
                <label className={styles.levelRow}>
                  <span className={styles.hint}>Level</span>
                  <input
                    className={styles.level}
                    type="number"
                    min={0}
                    max={100}
                    value={draft.oddsCrossLevel ?? 50}
                    disabled={busy || agent === undefined}
                    onChange={(event) => {
                      const level = Math.min(100, Math.max(0, Number(event.target.value)));
                      void persist({ triggers: { ...draft, oddsCross: true, oddsCrossLevel: Number.isFinite(level) ? level : 50 } });
                    }}
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Budget</span>
        <span className={styles.hint}>Max this agent can spend per day</span>
        <div className={styles.sliderRow}>
          <input
            className={styles.slider}
            type="range"
            min={100}
            max={maxBudget}
            step={100}
            value={Math.min(budget, maxBudget)}
            disabled={busy || agent === undefined}
            aria-label="Max this agent can spend per day"
            onChange={(event) => { void persist({ dailyBudgetCents: Number(event.target.value) }); }}
          />
          <span className={styles.budgetValue}>{formatBudgetCents(budget)} / day</span>
        </div>
        <span className={styles.hint}>Max per bet</span>
        <div className={styles.segment}>
          {BETS.map((cents) => (
            <button
              key={cents}
              type="button"
              className={styles.seg}
              aria-pressed={(agent?.maxPerBetCents ?? 200) === cents}
              disabled={busy || agent === undefined}
              onClick={() => { void persist({ maxPerBetCents: cents }); }}
            >
              {formatBudgetCents(cents)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>What it is allowed to do</span>
        <div className={styles.checks}>
          {PERMISSIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.radio}
              aria-pressed={(agent?.permission ?? "suggest") === item.value}
              disabled={busy || agent === undefined}
              onClick={() => { void persist({ permission: item.value }); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <button
          type="button"
          className={styles.check}
          aria-pressed={agent?.writeBriefs ?? false}
          disabled={busy || agent === undefined}
          onClick={() => { void persist({ writeBriefs: !(agent?.writeBriefs ?? false) }); }}
        >
          Write briefs
        </button>
        <span className={styles.hint}>Briefs cost $0.05 each, paid from this agent&apos;s budget, and are saved to Briefs. They use the existing deep dive.</span>
        {(agent?.writeBriefs ?? false) ? (
          <div className={styles.checks}>
            {BRIEF_WATCHES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={styles.check}
                aria-pressed={briefs[item.key]}
                disabled={busy}
                onClick={() => { void persist({ briefTriggers: { ...briefs, [item.key]: !briefs[item.key] } }); }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {agent !== undefined ? (
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void deleteAgent(agent.id).then((result) => {
                if (result !== undefined) onView(result);
                setBusy(false);
              });
            }}
          >
            Delete agent
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { agentFor, statusLine };
