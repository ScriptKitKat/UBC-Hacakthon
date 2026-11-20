import { describe, expect, it } from "vitest";
import type { AgentBudget } from "./budget";
import { permissionAction } from "./permissions";

const budget = (overrides: Partial<AgentBudget> = {}): AgentBudget => ({
  spentTodayCents: 0,
  remainingAgentCents: 300,
  remainingDeskCents: 1800,
  maxBetCents: 200,
  autonomousNotionalCents: 200,
  briefCostCents: 5,
  canAffordBrief: true,
  canAutonomousBet: true,
  autonomousBlockedReason: null,
  ...overrides,
});

describe("permission mapping", () => {
  it("maps watch-only to a notification and never a trade", () => {
    expect(permissionAction("watch", budget())).toEqual({ kind: "notify" });
  });

  it("maps suggest to a pending approval even when the size is under the auto-approve cap", () => {
    expect(permissionAction("suggest", budget({ maxBetCents: 100, autonomousNotionalCents: 100 }))).toEqual({
      kind: "suggest",
      notionalCents: 100,
      requireApproval: true,
    });
  });

  it("maps autonomous to a same-size bet only when the auto-approve cap allows it", () => {
    expect(permissionAction("autonomous", budget())).toEqual({
      kind: "autonomous",
      notionalCents: 200,
      requireApproval: false,
    });
  });

  it("holds a suggest or autonomous action when there is no budget", () => {
    expect(permissionAction("suggest", budget({ maxBetCents: 0 }))).toEqual({
      kind: "hold",
      reason: "There is no budget left to suggest a bet.",
    });
    expect(permissionAction("autonomous", budget({ canAutonomousBet: false, autonomousBlockedReason: "The bet is over the desk's auto-approve limit.", autonomousNotionalCents: 0 }))).toEqual({
      kind: "hold",
      reason: "The bet is over the desk's auto-approve limit.",
    });
  });
});
