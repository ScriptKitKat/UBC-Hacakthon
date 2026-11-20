import { describe, expect, it } from "vitest";
import { assignedBudgetCents, clampDailyBudget, evaluateBudget, type DeskBudget } from "./budget";
import { defaultAgent } from "./store";
import type { AgentRecord } from "./types";

const NOW = new Date("2026-11-19T18:00:00.000Z");
const DESK: DeskBudget = { dailyCapCents: 2000, remainingCents: 1800, perTradeMaxCents: 1000, autoApproveMaxCents: 200 };

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { ...defaultAgent({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES" }, NOW), dailyBudgetCents: 300, maxPerBetCents: 200, permission: "suggest", ...overrides };
}

describe("budget math", () => {
  it("clamps an agent's daily budget to the desk cap", () => {
    expect(clampDailyBudget(300, 2000)).toBe(300);
    expect(clampDailyBudget(5000, 2000)).toBe(2000);
    expect(clampDailyBudget(-10, 2000)).toBe(0);
  });

  it("rolls spend at UTC midnight and subtracts it from the remaining cap", () => {
    const sameDay = evaluateBudget(agent({ spentTodayCents: 150, spendDay: "2026-11-19" }), DESK, NOW);
    expect(sameDay.spentTodayCents).toBe(150);
    expect(sameDay.remainingAgentCents).toBe(150);
    expect(sameDay.maxBetCents).toBe(150);
    const nextDay = evaluateBudget(agent({ spentTodayCents: 150, spendDay: "2026-11-18" }), DESK, NOW);
    expect(nextDay.spentTodayCents).toBe(0);
    expect(nextDay.remainingAgentCents).toBe(300);
    expect(nextDay.maxBetCents).toBe(200);
  });

  it("caps an autonomous bet at the desk auto-approve limit", () => {
    const budget = evaluateBudget(agent({ permission: "autonomous", maxPerBetCents: 500, dailyBudgetCents: 800 }), DESK, NOW);
    expect(budget.maxBetCents).toBe(500);
    expect(budget.autonomousNotionalCents).toBe(200);
    expect(budget.canAutonomousBet).toBe(true);
  });

  it("blocks briefs and bets when either budget is exhausted", () => {
    const broke = evaluateBudget(agent({ spentTodayCents: 297, spendDay: "2026-11-19" }), DESK, NOW);
    expect(broke.canAffordBrief).toBe(false);
    expect(broke.maxBetCents).toBe(3);
    const deskEmpty = evaluateBudget(agent({ permission: "autonomous" }), { ...DESK, remainingCents: 0 }, NOW);
    expect(deskEmpty.canAffordBrief).toBe(false);
    expect(deskEmpty.canAutonomousBet).toBe(false);
    expect(deskEmpty.autonomousBlockedReason).toMatch(/no auto-approve budget/i);
  });

  it("sums assigned daily budget only for watching agents", () => {
    const watching = agent({ dailyBudgetCents: 300, status: "watching" });
    const paused = agent({ id: "p", dailyBudgetCents: 500, status: "paused" });
    expect(assignedBudgetCents([watching, paused])).toBe(300);
  });
});
