import type { Desk, ProposeRequest } from "@/features/desk";
import type { ClaudeSettings } from "@/features/claude";
import type { GrokSettings } from "@/features/grok";
import type { HistoryStore } from "@/features/history";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { marketQuery, type XFeed } from "@/features/xfeed";
import { nextRoutineAt } from "@/shared";
import type { AgentBudget, DeskBudget } from "./budget";
import { evaluateBudget } from "./budget";
import { composeDecision, composeMessage } from "./message";
import type { AgentDecision } from "./decide";
import { permissionAction } from "./permissions";
import type { AgentStore } from "./store";
import type { MarketSnapshot, TriggerResult } from "./triggers";
import { evaluateTriggers, isBriefTrigger, isWatchTrigger } from "./triggers";
import type { AgentActivity, AgentRecord, TriggerId } from "./types";
import { BRIEF_COST_CENTS, utcDay } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
export interface AgentCycleOptions {
  readonly review?: boolean;
  readonly origin?: "trigger" | "manual" | "scheduled";
}

interface TickOptions extends AgentCycleOptions {
  readonly lastRoutineAt?: string;
}

export interface AgentRunnerDeps {
  readonly store: AgentStore;
  readonly markets: Pick<GeminiMarketsClient, "getEvent" | "candles">;
  readonly history: HistoryStore;
  readonly desk: Pick<Desk, "proposeTrade" | "buyDeepDive" | "getSnapshot">;
  readonly grok: GrokSettings;
  readonly claude: ClaudeSettings;
  readonly fetch: typeof fetch;
  readonly operatorId: string;
  readonly xFeed?: Pick<XFeed, "signals">;
  readonly now?: () => Date;
  readonly allowAutonomous?: boolean;
}

export interface AgentTickResult {
  readonly agentId: string;
  readonly fired: readonly TriggerId[];
  readonly skipped: TriggerResult["skipped"];
  readonly marketUnavailable?: true;
  readonly message: string | null;
  readonly messageSource: AgentRecord["lastMessageSource"];
  readonly action: "none" | "notify" | "suggest" | "autonomous" | "brief" | "hold" | "skip";
  readonly origin?: "trigger" | "manual" | "scheduled";
  readonly side?: "yes" | "no";
  readonly amountCents?: number;
  readonly reason?: string;
  readonly intentId?: string;
}

export interface AgentCycleReport {
  readonly ran: number;
  readonly ticks: readonly AgentTickResult[];
}

function pickContract(event: MarketEvent, instrumentSymbol: string): MarketContract | undefined {
  const exact = event.contracts.find((contract) => contract.instrumentSymbol === instrumentSymbol);
  if (exact !== undefined) return exact;
  return event.contracts.find((contract) => contract.prices.buyYesCents !== null && contract.marketState !== "closed") ?? event.contracts[0];
}

async function yesCentsAt(deps: AgentRunnerDeps, symbol: string, atMs: number): Promise<number | null> {
  const points = deps.history.series(symbol);
  const atOrBefore = points.filter((point) => point.atMs <= atMs).at(-1);
  if (atOrBefore !== undefined) return atOrBefore.yesCents;
  const inWindow = points.find((point) => point.atMs >= atMs && point.atMs <= atMs + DAY_MS);
  if (inWindow !== undefined) return inWindow.yesCents;
  const candles = await deps.markets.candles(symbol, "1hr");
  if (!candles.ok) return null;
  const near = candles.value.filter((candle) => candle.timeMs <= atMs).at(-1) ?? candles.value.find((candle) => candle.timeMs >= atMs);
  return near?.closeCents ?? null;
}

export async function loadMarketSnapshot(deps: AgentRunnerDeps, agent: AgentRecord, now: Date): Promise<MarketSnapshot | undefined> {
  const eventResult = await deps.markets.getEvent(agent.eventTicker);
  if (!eventResult.ok) return undefined;
  const event = eventResult.value;
  const contract = pickContract(event, agent.instrumentSymbol);
  const symbol = contract?.instrumentSymbol ?? agent.instrumentSymbol;
  const yesNow = contract?.prices.buyYesCents ?? null;
  return {
    eventTitle: event.title,
    yesCents: yesNow,
    noCents: contract?.prices.buyNoCents ?? null,
    yesCents24hAgo: await yesCentsAt(deps, symbol, now.getTime() - DAY_MS),
    volume24h: event.volume24h,
    volumeTotal: event.volume,
    createdAt: event.createdAt ?? null,
    expiryDate: contract?.expiryDate ?? event.expiryDate,
  };
}

function deskBudgetFromSnapshot(policy: { dailyCapCents: number; remainingCents: number; perTradeMaxCents: number; autoApproveMaxCents: number }): DeskBudget {
  return {
    dailyCapCents: policy.dailyCapCents,
    remainingCents: policy.remainingCents,
    perTradeMaxCents: policy.perTradeMaxCents,
    autoApproveMaxCents: policy.autoApproveMaxCents,
  };
}

function activity(kind: AgentActivity["kind"], text: string, now: Date, extra: {
  trigger?: TriggerId | undefined;
  messageSource?: AgentActivity["messageSource"];
  intentId?: string | undefined;
  url?: string | undefined;
  origin?: AgentActivity["origin"];
  side?: AgentActivity["side"];
  amountCents?: number | undefined;
  explorerUrl?: string | undefined;
} = {}): AgentActivity {
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    kind,
    text,
    ...(extra.trigger === undefined ? {} : { trigger: extra.trigger }),
    ...(extra.messageSource === undefined ? {} : { messageSource: extra.messageSource }),
    ...(extra.intentId === undefined ? {} : { intentId: extra.intentId }),
    ...(extra.url === undefined ? {} : { url: extra.url }),
    ...(extra.origin === undefined ? {} : { origin: extra.origin }),
    ...(extra.side === undefined ? {} : { side: extra.side }),
    ...(extra.amountCents === undefined ? {} : { amountCents: extra.amountCents }),
    ...(extra.explorerUrl === undefined ? {} : { explorerUrl: extra.explorerUrl }),
  };
}

async function propose(deps: AgentRunnerDeps, agent: AgentRecord, snapshot: MarketSnapshot, outcome: "yes" | "no", action: Extract<ReturnType<typeof permissionAction>, { kind: "suggest" | "autonomous" }>): Promise<{ readonly entry: Awaited<ReturnType<Desk["proposeTrade"]>>; readonly spent: number }> {
  const seenPriceCents = outcome === "yes" ? snapshot.yesCents : snapshot.noCents;
  const request: ProposeRequest = {
    instrumentSymbol: agent.instrumentSymbol,
    outcome,
    notionalCents: action.notionalCents,
    source: "desk",
    senderId: deps.operatorId,
    ...(action.kind === "suggest" ? { requireApproval: true } : {}),
    ...(seenPriceCents === null ? {} : { seenPriceCents }),
  };
  const entry = await deps.desk.proposeTrade(request);
  return { entry, spent: entry.kind === "approve" ? action.notionalCents : 0 };
}

export async function runAgentTick(deps: AgentRunnerDeps, agent: AgentRecord, desk: DeskBudget, now: Date, options: TickOptions = {}): Promise<AgentTickResult> {
  const origin = options.origin ?? "trigger";
  const routineUpdate = options.lastRoutineAt === undefined ? {} : { lastRoutineAt: options.lastRoutineAt };
  const snapshot = await loadMarketSnapshot(deps, agent, now);
  if (snapshot === undefined) {
    await deps.store.recordRun(agent.id, {});
    return { agentId: agent.id, fired: [], skipped: [], marketUnavailable: true, message: null, messageSource: null, action: "none", origin };
  }
  const xEnabled = agent.triggers.xMentions || agent.triggers.breakingNews;
  const xFeed = xEnabled ? deps.xFeed : undefined;
  const xFeedAvailable = xFeed !== undefined;
  const xSignals = xFeed === undefined
    ? undefined
    : await xFeed.signals(marketQuery(snapshot.eventTitle ?? ""));
  const result = evaluateTriggers(agent, snapshot, now, {
    xFeedAvailable,
    ignoreCooldowns: options.review === true,
    ...(xFeedAvailable ? { x: xSignals } : {}),
  });
  const watchFired = result.fired.filter(isWatchTrigger);
  const briefFired = result.fired.filter(isBriefTrigger);
  if (watchFired.length === 0 && briefFired.length === 0 && options.review !== true) {
    await deps.store.recordRun(agent.id, routineUpdate);
    return { agentId: agent.id, fired: [], skipped: result.skipped, message: null, messageSource: null, action: "none", origin };
  }

  const activities: AgentActivity[] = [];
  const lastTriggerAt: Record<string, string> = {};
  if (options.review !== true) for (const id of result.fired) lastTriggerAt[id] = now.toISOString();

  const budget: AgentBudget = evaluateBudget(agent, desk, now);
  const mapped = permissionAction(agent.permission, budget);
  let decision: AgentDecision | undefined;
  let message: string;
  let messageSource: AgentRecord["lastMessageSource"];
  if ((watchFired.length > 0 || options.review === true) && (mapped.kind === "suggest" || (mapped.kind === "autonomous" && deps.allowAutonomous !== false))) {
    const composed = await composeDecision({ agent, result, snapshot, now, capCents: mapped.notionalCents, grok: deps.grok, claude: deps.claude, fetch: deps.fetch });
    decision = composed.decision;
    message = composed.text;
    messageSource = composed.source;
  } else {
    const composed = await composeMessage({ agent, result, snapshot, now, grok: deps.grok, claude: deps.claude, fetch: deps.fetch });
    message = composed.text;
    messageSource = composed.source;
  }
  const breakingPostUrl = result.fired.includes("breakingNews") ? result.x?.breakingPost?.url : undefined;
  activities.push(activity("message", message, now, {
    trigger: result.fired[0],
    messageSource,
    origin,
    ...(breakingPostUrl === undefined ? {} : { url: breakingPostUrl }),
  }));

  let spentDelta = 0;
  let action: AgentTickResult["action"] = "none";
  let intentId: string | undefined;
  let decisionSide: "yes" | "no" | undefined;
  let decisionAmount: number | undefined;
  let decisionReason: string | undefined;
  if (watchFired.length > 0 || options.review === true) {
    if (mapped.kind === "notify") {
      action = "notify";
    } else if (mapped.kind === "hold") {
      action = "hold";
      decisionReason = mapped.reason;
      activities.push(activity("refused", mapped.reason, now, { trigger: watchFired[0], origin }));
    } else if (mapped.kind === "autonomous" && deps.allowAutonomous === false) {
      action = "hold";
      decisionReason = "Autonomous betting is disabled in this run.";
      activities.push(activity("refused", decisionReason, now, { trigger: watchFired[0], origin }));
    } else if (decision === undefined || decision.action === "skip") {
      action = "skip";
      decisionReason = decision?.reason ?? "The agent could not make a valid decision.";
      activities.push(activity("skip", decisionReason, now, { trigger: watchFired[0], origin }));
    } else {
      const side = decision.side;
      const amountCents = decision.amountCents;
      if (side === undefined || amountCents === undefined) {
        action = "skip";
        decisionReason = decision.reason;
        activities.push(activity("skip", decision.reason, now, { trigger: watchFired[0], origin }));
      } else {
        const proposed = await propose(deps, agent, snapshot, side, { ...mapped, notionalCents: amountCents });
        intentId = proposed.entry.intentId;
        spentDelta += proposed.spent;
        decisionSide = side;
        decisionAmount = proposed.entry.notionalCents;
        decisionReason = decision.reason;
        const outcomeExtra = {
          trigger: watchFired[0],
          intentId,
          origin,
          side,
          amountCents: proposed.entry.notionalCents,
          ...(proposed.entry.explorerUrl === undefined ? {} : { explorerUrl: proposed.entry.explorerUrl }),
        };
        if (mapped.kind === "suggest" && proposed.entry.kind === "needs-approval") {
          action = "suggest";
          activities.push(activity("suggestion", proposed.entry.spokenReason, now, outcomeExtra));
        } else if (proposed.entry.kind === "approve") {
          action = "autonomous";
          activities.push(activity("bet", proposed.entry.spokenReason, now, outcomeExtra));
        } else if (proposed.entry.kind === "needs-approval") {
          action = "hold";
          decisionReason = "The desk required approval, so this agent did not bet on its own.";
          activities.push(activity("refused", decisionReason, now, outcomeExtra));
        } else {
          action = "hold";
          decisionReason = proposed.entry.spokenReason;
          activities.push(activity("refused", proposed.entry.spokenReason, now, outcomeExtra));
        }
      }
    }
  }

  if (briefFired.length > 0 && agent.writeBriefs) {
    const afterTrade = evaluateBudget({ ...agent, spentTodayCents: budget.spentTodayCents + spentDelta, spendDay: utcDay(now) }, desk, now);
    if (!afterTrade.canAffordBrief) {
      activities.push(activity("refused", "There is not enough budget left for a $0.05 brief.", now, { trigger: briefFired[0], origin }));
    } else {
      const dive = await deps.desk.buyDeepDive(agent.instrumentSymbol);
      if (dive.status === "delivered") {
        if (!dive.alreadyPurchased) spentDelta += BRIEF_COST_CENTS;
        activities.push(activity("brief", dive.alreadyPurchased ? "A saved deep-dive brief was reused." : "A deep-dive brief was written and saved.", now, { trigger: briefFired[0], origin }));
        if (action === "none" || action === "notify") action = "brief";
      } else {
        activities.push(activity("refused", dive.failureReason ?? "The deep-dive brief could not be purchased.", now, { trigger: briefFired[0], origin }));
      }
    }
  }

  await deps.store.recordRun(agent.id, {
    lastMessage: message,
    lastMessageSource: messageSource,
    ...(options.review !== true && result.fired.includes("breakingNews") && result.x?.breakingPost !== null && result.x?.breakingPost !== undefined
      ? { lastBreakingPostId: result.x.breakingPost.id }
      : {}),
    spentDeltaCents: spentDelta,
    ...(options.review === true ? {} : { lastTriggerAt }),
    activity: activities,
    ...routineUpdate,
  });
  const tick: AgentTickResult = {
    agentId: agent.id,
    fired: result.fired,
    skipped: result.skipped,
    message,
    messageSource,
    action,
    origin,
    ...(decisionSide === undefined ? {} : { side: decisionSide }),
    ...(decisionAmount === undefined ? {} : { amountCents: decisionAmount }),
    ...(decisionReason === undefined ? {} : { reason: decisionReason }),
  };
  return intentId === undefined ? tick : { ...tick, intentId };
}

export async function runAgentCycle(deps: AgentRunnerDeps, agentId?: string, options: AgentCycleOptions = {}): Promise<AgentCycleReport> {
  const now = (deps.now ?? (() => new Date()))();
  const snapshot = await deps.desk.getSnapshot();
  const desk = deskBudgetFromSnapshot(snapshot.policy);
  const ticks: AgentTickResult[] = [];
  const agents = await deps.store.list();
  for (const agent of agents) {
    if (agentId !== undefined && agent.id !== agentId) continue;
    if (agent.status !== "watching") continue;
    if (options.review === true) {
      ticks.push(await runAgentTick(deps, agent, desk, now, { ...options, origin: options.origin ?? "manual" }));
      continue;
    }
    const due = nextRoutineAt(agent.schedule, agent.lastRoutineAt);
    if (due !== null && now.getTime() >= due.getTime()) {
      ticks.push(await runAgentTick(deps, agent, desk, now, { review: true, origin: "scheduled", lastRoutineAt: now.toISOString() }));
      continue;
    }
    ticks.push(await runAgentTick(deps, agent, desk, now, { origin: "trigger" }));
  }
  return { ran: ticks.length, ticks };
}
