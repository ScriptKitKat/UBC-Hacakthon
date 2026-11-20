import type { AgentRecordView, AgentsView } from "@/shared";

export interface AgentDraft {
  name: string;
  model: AgentRecordView["model"] | undefined;
  personality: AgentRecordView["personality"];
  instructions: string;
  triggers: AgentRecordView["triggers"];
  dailyBudgetCents: number;
  maxPerBetCents: AgentRecordView["maxPerBetCents"];
  permission: AgentRecordView["permission"];
  writeBriefs: boolean;
  briefTriggers: AgentRecordView["briefTriggers"];
}

const DEFAULT_TRIGGERS: AgentRecordView["triggers"] = {
  oddsMove: true,
  volumeSpike: true,
  xMentions: false,
  breakingNews: false,
  oddsCross: false,
  oddsCrossLevel: 50,
  endingSoon: true,
};

const DEFAULT_BRIEF_TRIGGERS: AgentRecordView["briefTriggers"] = {
  oddsMove10: true,
  everyMonday: false,
  endingSoon: true,
};

function preferredAvailableModel(models: AgentsView["models"] | undefined): AgentDraft["model"] {
  if (models?.grok.available) return "grok";
  if (models?.claude.available) return "claude";
  if (models?.other.available) return "other";
  return undefined;
}

export function defaultAgentDraft(models: AgentsView["models"] | undefined, dailyCapCents: number): AgentDraft {
  const maxBudgetCents = Math.max(100, dailyCapCents);
  return {
    name: "Scout",
    model: preferredAvailableModel(models),
    personality: "calm",
    instructions: "",
    triggers: { ...DEFAULT_TRIGGERS },
    dailyBudgetCents: Math.min(300, maxBudgetCents),
    maxPerBetCents: 200,
    permission: "suggest",
    writeBriefs: false,
    briefTriggers: { ...DEFAULT_BRIEF_TRIGGERS },
  };
}

export function draftFromAgent(agent: AgentRecordView, models?: AgentsView["models"]): AgentDraft {
  return {
    name: agent.name,
    model: models === undefined || models[agent.model].available ? agent.model : undefined,
    personality: agent.personality,
    instructions: agent.instructions,
    triggers: { ...agent.triggers },
    dailyBudgetCents: agent.dailyBudgetCents,
    maxPerBetCents: agent.maxPerBetCents,
    permission: agent.permission,
    writeBriefs: agent.writeBriefs,
    briefTriggers: { ...agent.briefTriggers },
  };
}

export function createAgentBody(
  eventTicker: string,
  instrumentSymbol: string,
  draft: AgentDraft,
): Record<string, unknown> {
  return {
    eventTicker,
    instrumentSymbol,
    name: draft.name.trim(),
    ...(draft.model === undefined ? {} : { model: draft.model }),
    personality: draft.personality,
    instructions: draft.instructions,
    status: "watching",
    triggers: { ...draft.triggers },
    dailyBudgetCents: draft.dailyBudgetCents,
    maxPerBetCents: draft.maxPerBetCents,
    permission: draft.permission,
    writeBriefs: draft.writeBriefs,
    briefTriggers: { ...draft.briefTriggers },
  };
}

function sameFields<T extends object>(left: T, right: T): boolean {
  const leftKeys = Object.keys(left) as (keyof T)[];
  const rightKeys = Object.keys(right) as (keyof T)[];
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function patchFromDraft(agent: AgentRecordView, draft: AgentDraft): Record<string, unknown> {
  return {
    ...(agent.name === draft.name.trim() ? {} : { name: draft.name.trim() }),
    ...(draft.model === undefined || agent.model === draft.model ? {} : { model: draft.model }),
    ...(agent.personality === draft.personality ? {} : { personality: draft.personality }),
    ...(agent.instructions === draft.instructions ? {} : { instructions: draft.instructions }),
    ...(sameFields(agent.triggers, draft.triggers) ? {} : { triggers: { ...draft.triggers } }),
    ...(agent.dailyBudgetCents === draft.dailyBudgetCents ? {} : { dailyBudgetCents: draft.dailyBudgetCents }),
    ...(agent.maxPerBetCents === draft.maxPerBetCents ? {} : { maxPerBetCents: draft.maxPerBetCents }),
    ...(agent.permission === draft.permission ? {} : { permission: draft.permission }),
    ...(agent.writeBriefs === draft.writeBriefs ? {} : { writeBriefs: draft.writeBriefs }),
    ...(sameFields(agent.briefTriggers, draft.briefTriggers) ? {} : { briefTriggers: { ...draft.briefTriggers } }),
  };
}
