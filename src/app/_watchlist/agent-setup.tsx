"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import type { AgentRecordView, AgentsView, WatchlistCard } from "@/shared";
import { formatBudgetCents, friendlyEventTitle } from "@/shared";
import { saveAgent } from "../_shell/api";
import { createAgentBody, defaultAgentDraft, draftFromAgent, patchFromDraft } from "./agent-draft";
import type { AgentDraft } from "./agent-draft";
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

const WATCHES: readonly { key: Exclude<keyof AgentRecordView["triggers"], "oddsCrossLevel">; label: string }[] = [
  { key: "oddsMove", label: "Odds move 5+ points in a day" },
  { key: "volumeSpike", label: "Volume spikes 2x or more" },
  { key: "xMentions", label: "X mentions surge" },
  { key: "breakingNews", label: "Breaking news on the topic" },
  { key: "oddsCross", label: "Odds cross a level I set" },
  { key: "endingSoon", label: "48 hours before it ends" },
];

const BRIEF_WATCHES: readonly { key: keyof AgentRecordView["briefTriggers"]; label: string }[] = [
  { key: "oddsMove10", label: "When odds move 10+ points" },
  { key: "everyMonday", label: "Every Monday" },
  { key: "endingSoon", label: "48 hours before it ends" },
];

const PERMISSIONS: readonly {
  value: AgentRecordView["permission"];
  label: string;
  description: string;
}[] = [
  { value: "watch", label: "Watch and tell me", description: "Only sends messages when something happens." },
  { value: "suggest", label: "Suggest bets, I approve", description: "Proposes bets for you to approve in Portfolio." },
  { value: "autonomous", label: "Bet on its own within limits", description: "Places bets within your daily and per-bet limits." },
];

const BETS: readonly AgentRecordView["maxPerBetCents"][] = [100, 200, 500];

type SetupProps = {
  readonly view: AgentsView;
  readonly onView: (view: AgentsView) => void;
} & (
  | {
      readonly mode: "create";
      readonly card: WatchlistCard;
      readonly onCreated: (view: AgentsView, agentId: string) => void;
    }
  | {
      readonly mode: "edit";
      readonly agent: AgentRecordView;
      readonly onCancel: () => void;
      readonly onSaved: () => void;
    }
);

export function AgentSetup(props: SetupProps) {
  const [draft, setDraft] = useState<AgentDraft>(() =>
    props.mode === "create"
      ? defaultAgentDraft(props.view.models, props.view.desk.dailyCapCents)
      : draftFromAgent(props.agent, props.view.models)
  );
  const [instructionsOpen, setInstructionsOpen] = useState(
    props.mode === "edit" && props.agent.instructions.trim() !== "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableModels = MODELS.filter((model) => props.view.models[model.value].available);
  const modelLabel = (value: AgentRecordView["model"]) => MODELS.find((model) => model.value === value)?.label ?? value;
  const currentModelUnavailable = props.mode === "edit" && !props.view.models[props.agent.model].available;
  const maxBudget = Math.max(100, props.view.desk.dailyCapCents);
  const title = props.mode === "create"
    ? `New agent for ${friendlyEventTitle(props.card.eventTitle, props.card.expiryDate)}`
    : `Edit settings for ${props.agent.name}`;

  function setWatch(key: Exclude<keyof AgentRecordView["triggers"], "oddsCrossLevel">, value: boolean): void {
    setDraft((current) => {
      const triggers = { ...current.triggers, [key]: value };
      if (key === "oddsCross" && value && triggers.oddsCrossLevel === null) triggers.oddsCrossLevel = 50;
      return { ...current, triggers };
    });
  }

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || draft.name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const result = props.mode === "create"
        ? await saveAgent(createAgentBody(props.card.eventTicker, props.card.instrumentSymbol, draft))
        : await saveAgent(patchFromDraft(props.agent, draft), props.agent.id);
      if (result === undefined) {
        setError(props.mode === "create" ? "The agent could not be started. Try again." : "Settings could not be saved. Try again.");
        return;
      }
      props.onView(result);
      if (props.mode === "create") {
        const knownIds = new Set(props.view.agents.map((agent) => agent.id));
        const created = result.agents.find((agent) => !knownIds.has(agent.id));
        if (created === undefined) {
          setError("The agent was saved, but it could not be selected.");
          return;
        }
        props.onCreated(result, created.id);
      } else {
        props.onSaved();
      }
    } catch {
      setError(props.mode === "create" ? "The agent could not be started. Try again." : "Settings could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.editor} onSubmit={(event) => { void submit(event); }}>
      <div className={styles.editorHead}>
        <div>
          <p className={styles.forLabel}>{props.mode === "create" ? "Set up a watcher" : "Update this agent"}</p>
          <h2 className={styles.forTitle}>{title}</h2>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          className={styles.input}
          value={draft.name}
          disabled={busy}
          required
          maxLength={80}
          onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); }}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.label}>AI</span>
        {availableModels.length === 0 ? (
          <p className={styles.hint}>No AI key set — messages use a template</p>
        ) : availableModels.length === 1 ? (
          <div className={styles.aiStatus}>
            <span>AI: {availableModels[0]?.label} · connected</span>
            {props.mode === "edit" && draft.model !== availableModels[0]?.value ? (
              <button
                type="button"
                className={styles.activityToggle}
                disabled={busy}
                onClick={() => { setDraft((current) => ({ ...current, model: availableModels[0]?.value })); }}
              >
                Use {availableModels[0]?.label}
              </button>
            ) : null}
          </div>
        ) : (
          <div className={styles.segment}>
            {availableModels.map((model) => (
              <button
                key={model.value}
                type="button"
                className={styles.seg}
                aria-pressed={draft.model === model.value}
                disabled={busy}
                onClick={() => { setDraft((current) => ({ ...current, model: model.value })); }}
              >
                {model.label}
              </button>
            ))}
          </div>
        )}
        {currentModelUnavailable ? (
          <span className={styles.hint}>{modelLabel(props.agent.model)} is not configured; this agent uses template messages until you choose a connected model.</span>
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Personality</span>
        <div className={styles.segment}>
          {PERSONALITIES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.preset}
              aria-pressed={draft.personality === item.value}
              disabled={busy}
              title={item.blurb}
              onClick={() => { setDraft((current) => ({ ...current, personality: item.value })); }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className={styles.hint}>{PERSONALITIES.find((item) => item.value === draft.personality)?.blurb}</span>
        <button
          type="button"
          className={styles.activityToggle}
          aria-expanded={instructionsOpen}
          disabled={busy}
          onClick={() => { setInstructionsOpen((open) => !open); }}
        >
          {instructionsOpen ? "Hide your own instructions" : "Add your own instructions"}
        </button>
        {instructionsOpen ? (
          <textarea
            className={styles.textarea}
            value={draft.instructions}
            disabled={busy}
            placeholder="Optional instructions for this agent"
            onChange={(event) => { setDraft((current) => ({ ...current, instructions: event.target.value })); }}
          />
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>What to watch</span>
        <div className={styles.checks}>
          {WATCHES.map((item) => (
            <div key={item.key}>
              <button
                type="button"
                className={styles.check}
                aria-pressed={draft.triggers[item.key]}
                disabled={busy}
                onClick={() => { setWatch(item.key, !draft.triggers[item.key]); }}
              >
                {item.label}{(item.key === "xMentions" || item.key === "breakingNews") && !props.view.xFeed.available
                  ? " · needs X_BEARER_TOKEN"
                  : ""}
              </button>
              {item.key === "oddsCross" && draft.triggers.oddsCross ? (
                <label className={styles.levelRow}>
                  <span className={styles.hint}>Odds level</span>
                  <input
                    className={styles.level}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={draft.triggers.oddsCrossLevel ?? 50}
                    disabled={busy}
                    aria-label="Odds cross level"
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      const level = Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 50));
                      setDraft((current) => ({ ...current, triggers: { ...current.triggers, oddsCross: true, oddsCrossLevel: level } }));
                    }}
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Daily budget</span>
        <span className={styles.hint}>Maximum spend per day · desk cap {formatBudgetCents(props.view.desk.dailyCapCents)}</span>
        <div className={styles.sliderRow}>
          <input
            className={styles.slider}
            type="range"
            min={100}
            max={maxBudget}
            step={100}
            value={Math.min(draft.dailyBudgetCents, maxBudget)}
            disabled={busy}
            aria-label="Maximum spend per day"
            onChange={(event) => { setDraft((current) => ({ ...current, dailyBudgetCents: Number(event.target.value) })); }}
          />
          <span className={styles.budgetValue}>{formatBudgetCents(Math.min(draft.dailyBudgetCents, maxBudget))} / day</span>
        </div>
        <span className={styles.hint}>Maximum per bet</span>
        <div className={styles.segment}>
          {BETS.map((cents) => (
            <button
              key={cents}
              type="button"
              className={styles.seg}
              aria-pressed={draft.maxPerBetCents === cents}
              disabled={busy}
              onClick={() => { setDraft((current) => ({ ...current, maxPerBetCents: cents })); }}
            >
              {formatBudgetCents(cents)}
            </button>
          ))}
        </div>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>What it&apos;s allowed to do</legend>
        <div className={styles.permissionGrid}>
          {PERMISSIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.permissionOption}
              aria-pressed={draft.permission === item.value}
              disabled={busy}
              onClick={() => { setDraft((current) => ({ ...current, permission: item.value })); }}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <button
          type="button"
          className={styles.check}
          aria-pressed={draft.writeBriefs}
          disabled={busy}
          onClick={() => { setDraft((current) => ({ ...current, writeBriefs: !current.writeBriefs })); }}
        >
          Write briefs
        </button>
        <span className={styles.hint}>Briefs cost $0.05 each, come from this agent&apos;s budget, and appear in Briefs.</span>
        {draft.writeBriefs ? (
          <div className={styles.checks}>
            {BRIEF_WATCHES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={styles.check}
                aria-pressed={draft.briefTriggers[item.key]}
                disabled={busy}
                onClick={() => {
                  setDraft((current) => ({
                    ...current,
                    briefTriggers: { ...current.briefTriggers, [item.key]: !current.briefTriggers[item.key] },
                  }));
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.formActions}>
        {props.mode === "edit" ? (
          <button type="button" className={styles.cancel} disabled={busy} onClick={props.onCancel}>Cancel</button>
        ) : null}
        <button type="submit" className={styles.startButton} disabled={busy || draft.name.trim() === ""}>
          {busy ? "Saving…" : props.mode === "create" ? "Start agent" : "Save"}
        </button>
      </div>
    </form>
  );
}
