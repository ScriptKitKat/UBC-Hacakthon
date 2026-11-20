import { assignedBudgetCents, clampDailyBudget, modelAvailability } from "@/features/agents";
import type { AgentDraft, AgentPatch } from "@/features/agents";
import type { HomeServices } from "@/features/desk";
import { agentRecordSchema, agentsViewSchema } from "@/shared";
import type { AgentsView } from "@/shared";
import { z } from "zod";

type Services = Extract<HomeServices, { ok: true }>;

const triggerBody = z.object({
  oddsMove: z.boolean(),
  volumeSpike: z.boolean(),
  xMentions: z.boolean(),
  breakingNews: z.boolean(),
  oddsCross: z.boolean(),
  oddsCrossLevel: z.number().min(0).max(100).nullable(),
  endingSoon: z.boolean(),
});

const briefBody = z.object({
  oddsMove10: z.boolean(),
  everyMonday: z.boolean(),
  endingSoon: z.boolean(),
});

export const agentWriteBody = z.object({
  eventTicker: z.string().trim().min(1).optional(),
  instrumentSymbol: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  model: z.enum(["grok", "claude", "other"]).optional(),
  personality: z.enum(["calm", "contrarian", "momentum", "coach"]).optional(),
  instructions: z.string().optional(),
  status: z.enum(["watching", "paused"]).optional(),
  triggers: triggerBody.optional(),
  dailyBudgetCents: z.number().int().nonnegative().optional(),
  maxPerBetCents: z.union([z.literal(100), z.literal(200), z.literal(500)]).optional(),
  permission: z.enum(["watch", "suggest", "autonomous"]).optional(),
  writeBriefs: z.boolean().optional(),
  briefTriggers: briefBody.optional(),
});

export const agentCreateBody = agentWriteBody.required({ eventTicker: true, instrumentSymbol: true });

export async function agentsPayload(services: Services): Promise<AgentsView> {
  const [agents, snapshot] = await Promise.all([services.catalog.agents.store.list(), services.desk.getSnapshot()]);
  return agentsViewSchema.parse({
    agents: agentRecordSchema.array().parse(agents),
    models: modelAvailability(process.env),
    desk: {
      dailyCapCents: snapshot.policy.dailyCapCents,
      remainingCents: snapshot.policy.remainingCents,
      perTradeMaxCents: snapshot.policy.perTradeMaxCents,
      autoApproveMaxCents: snapshot.policy.autoApproveMaxCents,
    },
    assignedCents: assignedBudgetCents(agents),
  });
}

export function rejectedModel(model: "grok" | "claude" | "other" | undefined): Response | undefined {
  if (model === undefined) return undefined;
  const status = modelAvailability(process.env)[model];
  if (status.available) return undefined;
  return Response.json({ error: "invalid-request", issues: [`model: ${model} is not configured`] }, { status: 400 });
}

export function draftFrom(input: z.output<typeof agentCreateBody>, capCents: number): AgentDraft {
  return {
    eventTicker: input.eventTicker,
    instrumentSymbol: input.instrumentSymbol,
    dailyBudgetCents: clampDailyBudget(input.dailyBudgetCents ?? 300, capCents),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.personality === undefined ? {} : { personality: input.personality }),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.triggers === undefined ? {} : { triggers: input.triggers }),
    ...(input.maxPerBetCents === undefined ? {} : { maxPerBetCents: input.maxPerBetCents }),
    ...(input.permission === undefined ? {} : { permission: input.permission }),
    ...(input.writeBriefs === undefined ? {} : { writeBriefs: input.writeBriefs }),
    ...(input.briefTriggers === undefined ? {} : { briefTriggers: input.briefTriggers }),
  };
}

export function patchFrom(input: z.output<typeof agentWriteBody>, capCents: number): AgentPatch {
  return {
    ...(input.eventTicker === undefined ? {} : { eventTicker: input.eventTicker }),
    ...(input.instrumentSymbol === undefined ? {} : { instrumentSymbol: input.instrumentSymbol }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.personality === undefined ? {} : { personality: input.personality }),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.triggers === undefined ? {} : { triggers: input.triggers }),
    ...(input.dailyBudgetCents === undefined ? {} : { dailyBudgetCents: clampDailyBudget(input.dailyBudgetCents, capCents) }),
    ...(input.maxPerBetCents === undefined ? {} : { maxPerBetCents: input.maxPerBetCents }),
    ...(input.permission === undefined ? {} : { permission: input.permission }),
    ...(input.writeBriefs === undefined ? {} : { writeBriefs: input.writeBriefs }),
    ...(input.briefTriggers === undefined ? {} : { briefTriggers: input.briefTriggers }),
  };
}
