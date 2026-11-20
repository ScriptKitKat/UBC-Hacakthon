import type { Outcome } from "@/shared";

export interface AgentDecision {
  readonly action: "bet" | "skip";
  readonly side?: Outcome;
  readonly amountCents?: number;
  readonly reason: string;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function decisionReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function skip(reason: string): AgentDecision {
  return { action: "skip", reason };
}

export function clampDecision(raw: unknown, capCents: number): AgentDecision {
  if (!Number.isFinite(capCents) || capCents <= 0) return skip("No budget is available for a bet.");
  const value = objectValue(raw);
  if (value === undefined || (value.action !== "bet" && value.action !== "skip")) {
    return skip(decisionReason(value?.reason, "The agent could not make a valid decision."));
  }
  const reason = decisionReason(value.reason, value.action === "skip" ? "The agent chose to skip." : "The agent recommended this bet.");
  if (value.action === "skip") return skip(reason);
  if (value.side !== "yes" && value.side !== "no") return skip("The agent chose a bet without a valid side.");
  if (value.amountUsd !== undefined && (typeof value.amountUsd !== "number" || !Number.isFinite(value.amountUsd))) {
    return skip("The agent returned an invalid bet amount.");
  }
  const requested = value.amountUsd === undefined ? capCents : Math.round(value.amountUsd * 100);
  return { action: "bet", side: value.side, amountCents: Math.max(1, Math.min(Math.floor(capCents), requested)), reason };
}

export function ruleDecision(oddsMovePoints: number | null, capCents: number): AgentDecision {
  if (!Number.isFinite(capCents) || capCents <= 0) return skip("No budget is available for a bet.");
  if (oddsMovePoints === null || !Number.isFinite(oddsMovePoints) || oddsMovePoints === 0) return skip("price hasn't moved");
  return {
    action: "bet",
    side: oddsMovePoints > 0 ? "yes" : "no",
    amountCents: Math.floor(capCents),
    reason: "Fell back to the direction of the 24-hour price move.",
  };
}
