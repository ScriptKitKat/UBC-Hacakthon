import { z } from "zod";

export const agentModelSchema = z.enum(["grok", "claude", "other"]);
export const agentPersonalitySchema = z.enum(["calm", "contrarian", "momentum", "coach"]);
export const agentStatusSchema = z.enum(["watching", "paused"]);
export const agentPermissionSchema = z.enum(["watch", "suggest", "autonomous"]);
export const messageSourceSchema = z.enum(["llm", "template"]);
export const agentActivityKindSchema = z.enum(["message", "suggestion", "bet", "brief", "pause", "resume", "refused"]);
export const triggerIdSchema = z.enum([
  "oddsMove",
  "volumeSpike",
  "xMentions",
  "breakingNews",
  "oddsCross",
  "endingSoon",
  "briefOddsMove10",
  "briefMonday",
  "briefEndingSoon",
]);

export const watchTriggersSchema = z.object({
  oddsMove: z.boolean(),
  volumeSpike: z.boolean(),
  xMentions: z.boolean(),
  breakingNews: z.boolean(),
  oddsCross: z.boolean(),
  oddsCrossLevel: z.number().nullable(),
  endingSoon: z.boolean(),
});

export const briefTriggersSchema = z.object({
  oddsMove10: z.boolean(),
  everyMonday: z.boolean(),
  endingSoon: z.boolean(),
});

export const agentActivitySchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  kind: agentActivityKindSchema,
  text: z.string(),
  trigger: triggerIdSchema.optional(),
  messageSource: messageSourceSchema.optional(),
  intentId: z.string().optional(),
  url: z.url().optional(),
});

export const agentRecordSchema = z.object({
  id: z.string().min(1),
  eventTicker: z.string().min(1),
  instrumentSymbol: z.string().min(1),
  name: z.string().min(1),
  model: agentModelSchema,
  personality: agentPersonalitySchema,
  instructions: z.string(),
  status: agentStatusSchema,
  triggers: watchTriggersSchema,
  dailyBudgetCents: z.number().int().nonnegative(),
  maxPerBetCents: z.union([z.literal(100), z.literal(200), z.literal(500)]),
  permission: agentPermissionSchema,
  writeBriefs: z.boolean(),
  briefTriggers: briefTriggersSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunAt: z.string().nullable(),
  lastMessage: z.string().nullable(),
  lastMessageSource: messageSourceSchema.nullable(),
  lastBreakingPostId: z.string().min(1).optional(),
  spentTodayCents: z.number().int().nonnegative(),
  spendDay: z.string().min(1),
  lastTriggerAt: z.record(z.string(), z.string()),
  activity: z.array(agentActivitySchema),
});

export const agentModelStatusSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
});

export const agentModelsSchema = z.object({
  grok: agentModelStatusSchema,
  claude: agentModelStatusSchema,
  other: agentModelStatusSchema,
});

export const agentDeskBudgetSchema = z.object({
  dailyCapCents: z.number().int().nonnegative(),
  remainingCents: z.number().int().nonnegative(),
  perTradeMaxCents: z.number().int().nonnegative(),
  autoApproveMaxCents: z.number().int().nonnegative(),
});

export const agentsViewSchema = z.object({
  agents: z.array(agentRecordSchema),
  models: agentModelsSchema,
  xFeed: z.object({ available: z.boolean() }),
  desk: agentDeskBudgetSchema,
  assignedCents: z.number().int().nonnegative(),
});

export const agentCycleReportSchema = z.object({
  ran: z.number().int().nonnegative(),
  ticks: z.array(z.object({
    agentId: z.string(),
    fired: z.array(triggerIdSchema),
    skipped: z.array(z.object({ id: triggerIdSchema, reason: z.string() })),
    message: z.string().nullable(),
    messageSource: messageSourceSchema.nullable(),
    action: z.enum(["none", "notify", "suggest", "autonomous", "brief", "hold"]),
    intentId: z.string().optional(),
  })),
});

export type AgentRecordView = z.output<typeof agentRecordSchema>;
export type AgentsView = z.output<typeof agentsViewSchema>;
