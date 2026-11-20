import type { AgentBudget } from "./budget";
import type { AgentPermission } from "./types";

export type PermissionAction =
  | { readonly kind: "notify" }
  | { readonly kind: "suggest"; readonly notionalCents: number; readonly requireApproval: true }
  | { readonly kind: "autonomous"; readonly notionalCents: number; readonly requireApproval: false }
  | { readonly kind: "hold"; readonly reason: string };

export function permissionAction(permission: AgentPermission, budget: AgentBudget): PermissionAction {
  if (permission === "watch") return { kind: "notify" };
  if (permission === "suggest") {
    if (budget.maxBetCents <= 0) return { kind: "hold", reason: "There is no budget left to suggest a bet." };
    return { kind: "suggest", notionalCents: budget.maxBetCents, requireApproval: true };
  }
  if (!budget.canAutonomousBet) return { kind: "hold", reason: budget.autonomousBlockedReason ?? "The desk refused an autonomous bet." };
  return { kind: "autonomous", notionalCents: budget.autonomousNotionalCents, requireApproval: false };
}
