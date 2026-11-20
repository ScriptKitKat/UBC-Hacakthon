import { z } from "zod";

export const agentModelSchema = z.enum(["grok", "claude", "other"]);
export const agentPersonalitySchema = z.enum(["calm", "contrarian", "momentum", "coach"]);
export const agentStatusSchema = z.enum(["watching", "paused"]);
export const agentPermissionSchema = z.enum(["watch", "suggest", "autonomous"]);
export const messageSourceSchema = z.enum(["llm", "template"]);
export const agentActivityKindSchema = z.enum(["message", "suggestion", "bet", "brief", "pause", "resume", "refused", "skip"]);
export const agentScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("every"), hours: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(12)]) }),
  z.object({
    kind: z.literal("daily"),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    timeZone: z.string().min(1).refine((timeZone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
      } catch {
        return false;
      }
    }),
  }),
]);
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
  origin: z.enum(["trigger", "manual", "scheduled"]).optional(),
  side: z.enum(["yes", "no"]).optional(),
  amountCents: z.number().int().positive().optional(),
  explorerUrl: z.url().optional(),
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
  schedule: agentScheduleSchema.default({ kind: "none" }),
  lastRoutineAt: z.string().nullable().default(null),
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
    marketUnavailable: z.literal(true).optional(),
    message: z.string().nullable(),
    messageSource: messageSourceSchema.nullable(),
    action: z.enum(["none", "notify", "suggest", "autonomous", "brief", "hold", "skip"]),
    intentId: z.string().optional(),
    origin: z.enum(["trigger", "manual", "scheduled"]).optional(),
    side: z.enum(["yes", "no"]).optional(),
    amountCents: z.number().int().positive().optional(),
    reason: z.string().optional(),
  })),
});

export type AgentRecordView = z.output<typeof agentRecordSchema>;
export type AgentsView = z.output<typeof agentsViewSchema>;
export type AgentSchedule = z.output<typeof agentScheduleSchema>;

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year ?? 0, month: value.month ?? 0, day: value.day ?? 0, hour: value.hour ?? 0, minute: value.minute ?? 0 };
}

function sameZonedMinute(parts: ZonedParts, year: number, month: number, day: number, hour: number, minute: number): boolean {
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
}

function offsetAt(atMs: number, timeZone: string): number {
  const parts = zonedParts(new Date(atMs), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - atMs;
}

function dailyCandidates(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number[] {
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([
    offsetAt(wallTime - 86_400_000, timeZone),
    offsetAt(wallTime, timeZone),
    offsetAt(wallTime + 86_400_000, timeZone),
  ]);
  return [...offsets]
    .map((offset) => wallTime - offset)
    .filter((candidate) => sameZonedMinute(zonedParts(new Date(candidate), timeZone), year, month, day, hour, minute));
}

export function nextRoutineAt(schedule: AgentSchedule, lastRoutineAt: string | null): Date | null {
  if (schedule.kind === "none" || lastRoutineAt === null) return null;
  const last = Date.parse(lastRoutineAt);
  if (!Number.isFinite(last)) return null;
  if (schedule.kind === "every") return new Date(last + schedule.hours * 60 * 60_000);

  const lastDate = zonedParts(new Date(last), schedule.timeZone);
  const [hourText, minuteText] = schedule.time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const scheduleMinute = hour * 60 + minute;
  const lastMinute = lastDate.hour * 60 + lastDate.minute;
  const firstOffsetDays = lastMinute >= scheduleMinute ? 1 : 0;
  for (let offsetDays = firstOffsetDays; offsetDays < firstOffsetDays + 370; offsetDays += 1) {
    const date = new Date(Date.UTC(lastDate.year, lastDate.month - 1, lastDate.day + offsetDays));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    for (let advanceMinute = 0; advanceMinute < 180; advanceMinute += 1) {
      const minuteOfDay = hour * 60 + minute + advanceMinute;
      const candidateDate = new Date(Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
      const candidates = dailyCandidates(
        candidateDate.getUTCFullYear(),
        candidateDate.getUTCMonth() + 1,
        candidateDate.getUTCDate(),
        candidateDate.getUTCHours(),
        candidateDate.getUTCMinutes(),
        schedule.timeZone,
      );
      const future = candidates.filter((candidate) => candidate > last);
      if (future.length > 0) return new Date(Math.min(...future));
      if (candidates.length > 0) break;
      if (minuteOfDay >= 24 * 60 - 1) break;
    }
  }
  return null;
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function rolledSpend(
  agent: { readonly spentTodayCents: number; readonly spendDay: string },
  now: Date,
): { readonly spentTodayCents: number; readonly spendDay: string } {
  const day = utcDay(now);
  return day === agent.spendDay
    ? { spentTodayCents: agent.spentTodayCents, spendDay: day }
    : { spentTodayCents: 0, spendDay: day };
}
