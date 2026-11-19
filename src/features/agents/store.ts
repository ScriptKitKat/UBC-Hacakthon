import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentRecordSchema } from "@/shared";
import { createJsonStore, createSerialQueue } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import {
  DEFAULT_BRIEF_TRIGGERS,
  DEFAULT_DAILY_BUDGET_CENTS,
  DEFAULT_MAX_PER_BET_CENTS,
  DEFAULT_TRIGGERS,
  rolledSpend,
  utcDay,
  type AgentActivity,
  type AgentRecord,
  type AgentStatus,
} from "./types";

const fileSchema = z.object({ agents: z.array(agentRecordSchema) });

export type AgentDraft = {
  readonly eventTicker: string;
  readonly instrumentSymbol: string;
  readonly name?: string;
  readonly model?: AgentRecord["model"];
  readonly personality?: AgentRecord["personality"];
  readonly instructions?: string;
  readonly status?: AgentStatus;
  readonly triggers?: AgentRecord["triggers"];
  readonly dailyBudgetCents?: number;
  readonly maxPerBetCents?: AgentRecord["maxPerBetCents"];
  readonly permission?: AgentRecord["permission"];
  readonly writeBriefs?: boolean;
  readonly briefTriggers?: AgentRecord["briefTriggers"];
};

export type AgentPatch = Partial<Omit<AgentDraft, "eventTicker" | "instrumentSymbol">> & {
  readonly eventTicker?: string;
  readonly instrumentSymbol?: string;
};

export interface AgentStore {
  readonly list: () => Promise<readonly AgentRecord[]>;
  readonly get: (id: string) => Promise<AgentRecord | undefined>;
  readonly forMarket: (eventTicker: string) => Promise<AgentRecord | undefined>;
  readonly create: (draft: AgentDraft) => Promise<AgentRecord>;
  readonly update: (id: string, patch: AgentPatch) => Promise<AgentRecord | undefined>;
  readonly setStatus: (id: string, status: AgentStatus) => Promise<AgentRecord | undefined>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly recordRun: (id: string, update: {
    readonly lastMessage?: string;
    readonly lastMessageSource?: AgentRecord["lastMessageSource"];
    readonly spentDeltaCents?: number;
    readonly lastTriggerAt?: Readonly<Record<string, string>>;
    readonly activity?: readonly AgentActivity[];
  }) => Promise<AgentRecord | undefined>;
}

export function defaultAgent(draft: AgentDraft, now: Date): AgentRecord {
  const at = now.toISOString();
  return {
    id: randomUUID(),
    eventTicker: draft.eventTicker,
    instrumentSymbol: draft.instrumentSymbol,
    name: draft.name?.trim() || "Scout",
    model: draft.model ?? "grok",
    personality: draft.personality ?? "calm",
    instructions: draft.instructions ?? "",
    status: draft.status ?? "watching",
    triggers: draft.triggers ?? DEFAULT_TRIGGERS,
    dailyBudgetCents: draft.dailyBudgetCents ?? DEFAULT_DAILY_BUDGET_CENTS,
    maxPerBetCents: draft.maxPerBetCents ?? DEFAULT_MAX_PER_BET_CENTS,
    permission: draft.permission ?? "suggest",
    writeBriefs: draft.writeBriefs ?? false,
    briefTriggers: draft.briefTriggers ?? DEFAULT_BRIEF_TRIGGERS,
    createdAt: at,
    updatedAt: at,
    lastRunAt: null,
    lastMessage: null,
    lastMessageSource: null,
    spentTodayCents: 0,
    spendDay: utcDay(now),
    lastTriggerAt: {},
    activity: [],
  };
}

export function openAgentStore(options: { readonly fs: FileSystem; readonly path: string; readonly now?: () => Date; readonly id?: () => string }): AgentStore {
  const store = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ agents: [] }) });
  const queue = createSerialQueue();
  const now = options.now ?? (() => new Date());

  async function load(): Promise<AgentRecord[]> {
    return [...(await store.load()).agents];
  }

  async function write(agents: readonly AgentRecord[]): Promise<readonly AgentRecord[]> {
    await store.save({ agents: agents.map((agent) => ({ ...agent, activity: [...agent.activity], lastTriggerAt: { ...agent.lastTriggerAt } })) });
    return agents;
  }

  function replace(agents: AgentRecord[], next: AgentRecord): AgentRecord[] {
    return agents.map((agent) => (agent.id === next.id ? next : agent));
  }

  return {
    list: load,
    async get(id) {
      return (await load()).find((agent) => agent.id === id);
    },
    async forMarket(eventTicker) {
      return (await load()).find((agent) => agent.eventTicker === eventTicker);
    },
    create(draft) {
      return queue.run(async () => {
        const agents = await load();
        if (agents.some((agent) => agent.eventTicker === draft.eventTicker)) {
          return agents.find((agent) => agent.eventTicker === draft.eventTicker) as AgentRecord;
        }
        const created = defaultAgent(draft, now());
        const agent = options.id === undefined ? created : { ...created, id: options.id() };
        await write([...agents, agent]);
        return agent;
      });
    },
    update(id, patch) {
      return queue.run(async () => {
        const agents = await load();
        const current = agents.find((agent) => agent.id === id);
        if (current === undefined) return undefined;
        const next: AgentRecord = {
          ...current,
          ...patch,
          id: current.id,
          eventTicker: patch.eventTicker ?? current.eventTicker,
          instrumentSymbol: patch.instrumentSymbol ?? current.instrumentSymbol,
          name: patch.name?.trim() || current.name,
          triggers: patch.triggers ?? current.triggers,
          briefTriggers: patch.briefTriggers ?? current.briefTriggers,
          updatedAt: now().toISOString(),
        };
        await write(replace(agents, next));
        return next;
      });
    },
    setStatus(id, status) {
      return queue.run(async () => {
        const agents = await load();
        const current = agents.find((agent) => agent.id === id);
        if (current === undefined) return undefined;
        if (current.status === status) return current;
        const at = now().toISOString();
        const entry: AgentActivity = {
          id: options.id === undefined ? randomUUID() : options.id(),
          at,
          kind: status === "paused" ? "pause" : "resume",
          text: status === "paused" ? `${current.name} was paused.` : `${current.name} is watching again.`,
        };
        const next: AgentRecord = { ...current, status, updatedAt: at, activity: [entry, ...current.activity].slice(0, 50) };
        await write(replace(agents, next));
        return next;
      });
    },
    remove(id) {
      return queue.run(async () => {
        const agents = await load();
        if (!agents.some((agent) => agent.id === id)) return false;
        await write(agents.filter((agent) => agent.id !== id));
        return true;
      });
    },
    recordRun(id, update) {
      return queue.run(async () => {
        const agents = await load();
        const current = agents.find((agent) => agent.id === id);
        if (current === undefined) return undefined;
        const clock = now();
        const rolled = rolledSpend(current, clock);
        const spent = rolled.spentTodayCents + (update.spentDeltaCents ?? 0);
        const next: AgentRecord = {
          ...current,
          lastRunAt: clock.toISOString(),
          updatedAt: clock.toISOString(),
          lastMessage: update.lastMessage === undefined ? current.lastMessage : update.lastMessage,
          lastMessageSource: update.lastMessageSource === undefined ? current.lastMessageSource : update.lastMessageSource,
          spentTodayCents: spent,
          spendDay: rolled.spendDay,
          lastTriggerAt: { ...current.lastTriggerAt, ...(update.lastTriggerAt ?? {}) },
          activity: [...(update.activity ?? []), ...current.activity].slice(0, 50),
        };
        await write(replace(agents, next));
        return next;
      });
    },
  };
}
