import type { Desk, ProposeRequest } from "@/features/desk";
import type { GrokSettings } from "@/features/grok";
import type { HistoryStore } from "@/features/history";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import type { AgentBudget, DeskBudget } from "./budget";
import { evaluateBudget } from "./budget";
import { composeMessage } from "./message";
import { permissionAction } from "./permissions";
import type { AgentStore } from "./store";
import type { MarketSnapshot, TriggerResult } from "./triggers";
import { evaluateTriggers, isBriefTrigger, isWatchTrigger } from "./triggers";
import type { AgentActivity, AgentRecord, TriggerId } from "./types";
import { BRIEF_COST_CENTS, utcDay } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRADE_TRIGGERS: ReadonlySet<TriggerId> = new Set(["oddsMove", "volumeSpike", "oddsCross"]);

export interface AgentRunnerDeps {
  readonly store: AgentStore;
  readonly markets: Pick<GeminiMarketsClient, "getEvent" | "candles">;
  readonly history: HistoryStore;
  readonly desk: Pick<Desk, "proposeTrade" | "buyDeepDive" | "getSnapshot">;
  readonly grok: GrokSettings;
  readonly fetch: typeof fetch;
  readonly operatorId: string;
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
  readonly action: "none" | "notify" | "suggest" | "autonomous" | "brief" | "hold";
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
    yesCents: yesNow,
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

function tradeOutcome(result: TriggerResult): "yes" | "no" | undefined {
  if (result.todayPoints === null || result.todayPoints === 0) return undefined;
  return result.todayPoints > 0 ? "yes" : "no";
}

function activity(kind: AgentActivity["kind"], text: string, now: Date, extra: { trigger?: TriggerId | undefined; messageSource?: AgentActivity["messageSource"]; intentId?: string | undefined } = {}): AgentActivity {
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    kind,
    text,
    ...(extra.trigger === undefined ? {} : { trigger: extra.trigger }),
    ...(extra.messageSource === undefined ? {} : { messageSource: extra.messageSource }),
    ...(extra.intentId === undefined ? {} : { intentId: extra.intentId }),
  };
}

async function propose(deps: AgentRunnerDeps, agent: AgentRecord, snapshot: MarketSnapshot, outcome: "yes" | "no", action: Extract<ReturnType<typeof permissionAction>, { kind: "suggest" | "autonomous" }>): Promise<{ readonly entry: Awaited<ReturnType<Desk["proposeTrade"]>>; readonly spent: number }> {
  const request: ProposeRequest = {
    instrumentSymbol: agent.instrumentSymbol,
    outcome,
    notionalCents: action.notionalCents,
    source: "desk",
    senderId: deps.operatorId,
    ...(action.kind === "suggest" ? { requireApproval: true } : {}),
    ...(snapshot.yesCents === null ? {} : { seenPriceCents: snapshot.yesCents }),
  };
  const entry = await deps.desk.proposeTrade(request);
  return { entry, spent: entry.kind === "approve" ? action.notionalCents : 0 };
}

export async function runAgentTick(deps: AgentRunnerDeps, agent: AgentRecord, desk: DeskBudget, now: Date): Promise<AgentTickResult> {
  const snapshot = await loadMarketSnapshot(deps, agent, now);
  if (snapshot === undefined) {
    await deps.store.recordRun(agent.id, {});
    return { agentId: agent.id, fired: [], skipped: [], marketUnavailable: true, message: null, messageSource: null, action: "none" };
  }
  const result = evaluateTriggers(agent, snapshot, now);
  const watchFired = result.fired.filter(isWatchTrigger);
  const briefFired = result.fired.filter(isBriefTrigger);
  if (watchFired.length === 0 && briefFired.length === 0) {
    await deps.store.recordRun(agent.id, {});
    return { agentId: agent.id, fired: [], skipped: result.skipped, message: null, messageSource: null, action: "none" };
  }

  const activities: AgentActivity[] = [];
  const lastTriggerAt: Record<string, string> = {};
  for (const id of result.fired) lastTriggerAt[id] = now.toISOString();

  const composed = await composeMessage({ agent, result, snapshot, now, grok: deps.grok, fetch: deps.fetch });
  const message = composed.text;
  const messageSource = composed.source;
  activities.push(activity("message", composed.text, now, { trigger: result.fired[0], messageSource: composed.source }));

  let spentDelta = 0;
  let action: AgentTickResult["action"] = "none";
  let intentId: string | undefined;
  const budget: AgentBudget = evaluateBudget(agent, desk, now);

  if (watchFired.some((id) => TRADE_TRIGGERS.has(id))) {
    const mapped = permissionAction(agent.permission, budget);
    const outcome = tradeOutcome(result);
    if (mapped.kind === "notify") {
      action = "notify";
    } else if (mapped.kind === "hold") {
      action = "hold";
      activities.push(activity("refused", mapped.reason, now, { trigger: watchFired[0] }));
    } else if (mapped.kind === "autonomous" && deps.allowAutonomous === false) {
      action = "hold";
      activities.push(activity("refused", "Autonomous betting is disabled in this run.", now, { trigger: watchFired[0] }));
    } else if (outcome === undefined) {
      action = "hold";
      activities.push(activity("refused", "The price has not moved in the last day, so there is no side to bet on.", now, { trigger: watchFired[0] }));
    } else {
      const proposed = await propose(deps, agent, snapshot, outcome, mapped);
      intentId = proposed.entry.intentId;
      spentDelta += proposed.spent;
      if (mapped.kind === "suggest" && proposed.entry.kind === "needs-approval") {
        action = "suggest";
        activities.push(activity("suggestion", proposed.entry.spokenReason, now, { trigger: watchFired[0], intentId }));
      } else if (proposed.entry.kind === "approve") {
        action = "autonomous";
        activities.push(activity("bet", proposed.entry.spokenReason, now, { trigger: watchFired[0], intentId }));
      } else if (proposed.entry.kind === "needs-approval") {
        action = "hold";
        activities.push(activity("refused", "The desk required approval, so this agent did not bet on its own.", now, { trigger: watchFired[0], intentId }));
      } else {
        action = "hold";
        activities.push(activity("refused", proposed.entry.spokenReason, now, { trigger: watchFired[0], intentId }));
      }
    }
  } else if (watchFired.length > 0) {
    action = "notify";
  }

  if (briefFired.length > 0 && agent.writeBriefs) {
    const afterTrade = evaluateBudget({ ...agent, spentTodayCents: budget.spentTodayCents + spentDelta, spendDay: utcDay(now) }, desk, now);
    if (!afterTrade.canAffordBrief) {
      activities.push(activity("refused", "There is not enough budget left for a $0.05 brief.", now, { trigger: briefFired[0] }));
    } else {
      const dive = await deps.desk.buyDeepDive(agent.instrumentSymbol);
      if (dive.status === "delivered") {
        spentDelta += BRIEF_COST_CENTS;
        activities.push(activity("brief", "A deep-dive brief was written and saved.", now, { trigger: briefFired[0] }));
        if (action === "none" || action === "notify") action = "brief";
      } else {
        activities.push(activity("refused", dive.failureReason ?? "The deep-dive brief could not be purchased.", now, { trigger: briefFired[0] }));
      }
    }
  }

  await deps.store.recordRun(agent.id, {
    lastMessage: message,
    lastMessageSource: messageSource,
    spentDeltaCents: spentDelta,
    lastTriggerAt,
    activity: activities,
  });
  const tick: AgentTickResult = { agentId: agent.id, fired: result.fired, skipped: result.skipped, message, messageSource, action };
  return intentId === undefined ? tick : { ...tick, intentId };
}

export async function runAgentCycle(deps: AgentRunnerDeps, agentId?: string): Promise<AgentCycleReport> {
  const now = (deps.now ?? (() => new Date()))();
  const snapshot = await deps.desk.getSnapshot();
  const desk = deskBudgetFromSnapshot(snapshot.policy);
  const ticks: AgentTickResult[] = [];
  const agents = await deps.store.list();
  for (const agent of agents) {
    if (agentId !== undefined && agent.id !== agentId) continue;
    if (agent.status !== "watching") continue;
    ticks.push(await runAgentTick(deps, agent, desk, now));
  }
  return { ran: ticks.length, ticks };
}
