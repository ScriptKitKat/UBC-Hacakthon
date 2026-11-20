import { BRIEF_COST_CENTS, rolledSpend, type AgentRecord } from "./types";

export interface DeskBudget {
  readonly dailyCapCents: number;
  readonly remainingCents: number;
  readonly perTradeMaxCents: number;
  readonly autoApproveMaxCents: number;
}

export interface AgentBudget {
  readonly spentTodayCents: number;
  readonly remainingAgentCents: number;
  readonly remainingDeskCents: number;
  readonly maxBetCents: number;
  readonly autonomousNotionalCents: number;
  readonly briefCostCents: number;
  readonly canAffordBrief: boolean;
  readonly canAutonomousBet: boolean;
  readonly autonomousBlockedReason: string | null;
}

export function clampDailyBudget(cents: number, deskCapCents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(Math.round(cents), Math.max(0, deskCapCents)));
}

export function evaluateBudget(agent: AgentRecord, desk: DeskBudget, now: Date): AgentBudget {
  const rolled = rolledSpend(agent, now);
  const remainingAgent = Math.max(0, agent.dailyBudgetCents - rolled.spentTodayCents);
  const remainingDesk = Math.max(0, desk.remainingCents);
  const maxBet = Math.max(0, Math.min(agent.maxPerBetCents, desk.perTradeMaxCents, remainingAgent, remainingDesk));
  const autonomousNotional = Math.max(0, Math.min(maxBet, desk.autoApproveMaxCents));
  const canAffordBrief = remainingAgent >= BRIEF_COST_CENTS && remainingDesk >= BRIEF_COST_CENTS;
  let autonomousBlockedReason: string | null = null;
  if (agent.permission !== "autonomous") autonomousBlockedReason = "This agent is not allowed to bet on its own.";
  else if (autonomousNotional <= 0) autonomousBlockedReason = "There is no auto-approve budget left for this agent or the desk.";
  return {
    spentTodayCents: rolled.spentTodayCents,
    remainingAgentCents: remainingAgent,
    remainingDeskCents: remainingDesk,
    maxBetCents: maxBet,
    autonomousNotionalCents: autonomousNotional,
    briefCostCents: BRIEF_COST_CENTS,
    canAffordBrief,
    canAutonomousBet: autonomousBlockedReason === null,
    autonomousBlockedReason,
  };
}

export function assignedBudgetCents(agents: readonly AgentRecord[]): number {
  return agents.filter((agent) => agent.status === "watching").reduce((sum, agent) => sum + agent.dailyBudgetCents, 0);
}
