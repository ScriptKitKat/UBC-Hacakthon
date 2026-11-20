import { describe, expect, it } from "vitest";
import type { AgentRecordView, AgentsView } from "@/shared";
import { createAgentBody, defaultAgentDraft, draftFromAgent, patchFromDraft } from "./agent-draft";

const MODELS: AgentsView["models"] = {
  grok: { available: true, reason: null },
  claude: { available: true, reason: null },
  other: { available: false, reason: "not configured" },
};

const AGENT: AgentRecordView = {
  id: "agent-1",
  eventTicker: "BTC",
  instrumentSymbol: "GEMI-BTC-YES",
  name: "Scout",
  model: "grok",
  personality: "calm",
  instructions: "",
  status: "watching",
  triggers: {
    oddsMove: true,
    volumeSpike: true,
    xMentions: false,
    breakingNews: false,
    oddsCross: false,
    oddsCrossLevel: null,
    endingSoon: true,
  },
  dailyBudgetCents: 300,
  maxPerBetCents: 200,
  permission: "suggest",
  writeBriefs: false,
  briefTriggers: { oddsMove10: true, everyMonday: false, endingSoon: true },
  createdAt: "2026-11-20T12:00:00.000Z",
  updatedAt: "2026-11-20T12:00:00.000Z",
  lastRunAt: null,
  schedule: { kind: "none" },
  lastRoutineAt: null,
  lastMessage: null,
  lastMessageSource: null,
  spentTodayCents: 0,
  spendDay: "2026-11-20",
  lastTriggerAt: {},
  activity: [],
};

describe("agent draft", () => {
  it("starts with local defaults and prefers the server model selection order", () => {
    expect(defaultAgentDraft(MODELS, 2000)).toMatchObject({
      name: "Scout",
      model: "grok",
      permission: "suggest",
      dailyBudgetCents: 300,
      maxPerBetCents: 200,
      triggers: { oddsMove: true, oddsCrossLevel: 50 },
      briefTriggers: { oddsMove10: true, everyMonday: false },
    });
    expect(defaultAgentDraft({ ...MODELS, grok: { available: false, reason: "not configured" } }, 2000).model).toBe("claude");
    expect(defaultAgentDraft(undefined, 2000).model).toBeUndefined();
    expect(defaultAgentDraft(MODELS, 100).dailyBudgetCents).toBe(100);
  });

  it("copies editable fields and preserves an unavailable saved model", () => {
    const draft = draftFromAgent(AGENT, { ...MODELS, grok: { available: false, reason: "not configured" } });
    expect(draft).toMatchObject({ name: "Scout", model: undefined, permission: "suggest" });
    expect(draft.triggers).not.toBe(AGENT.triggers);
    expect(draft.briefTriggers).not.toBe(AGENT.briefTriggers);
  });

  it("builds a start body without a model when no model is available", () => {
    const draft = defaultAgentDraft(undefined, 2000);
    const body = createAgentBody("BTC", "GEMI-BTC-YES", draft);
    expect(body).toMatchObject({
      eventTicker: "BTC",
      instrumentSymbol: "GEMI-BTC-YES",
      name: "Scout",
      status: "watching",
      permission: "suggest",
    });
    expect(body).not.toHaveProperty("model");
  });

  it("patches only changed fields and compares trigger objects by value", () => {
    const draft = draftFromAgent(AGENT, MODELS);
    expect(patchFromDraft(AGENT, draft)).toEqual({});

    const changed: typeof draft = {
      ...draft,
      name: "  Trend Scout ",
      triggers: { ...draft.triggers, xMentions: true },
      briefTriggers: { ...draft.briefTriggers, everyMonday: true },
    };
    expect(patchFromDraft(AGENT, changed)).toEqual({
      name: "Trend Scout",
      triggers: { ...AGENT.triggers, xMentions: true },
      briefTriggers: { ...AGENT.briefTriggers, everyMonday: true },
    });
  });
});
