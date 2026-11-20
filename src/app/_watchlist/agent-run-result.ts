import { formatBudgetCents } from "@/shared";

export function agentRunResultText(
  tick: {
    readonly marketUnavailable?: boolean | undefined;
    readonly fired: readonly string[];
    readonly skipped: readonly { readonly reason: string }[];
    readonly action?: string | undefined;
    readonly side?: "yes" | "no" | undefined;
    readonly amountCents?: number | undefined;
    readonly reason?: string | undefined;
  },
  firedLabels: readonly string[],
): string {
  if (tick.marketUnavailable === true) return "Couldn't load market data for this run.";
  if (tick.action === "autonomous" && tick.side !== undefined && tick.amountCents !== undefined) {
    return `Bet ${formatBudgetCents(tick.amountCents)} on ${tick.side === "yes" ? "Yes" : "No"}: ${tick.reason ?? "approved by the desk"}`;
  }
  if (tick.action === "suggest" && tick.side !== undefined && tick.amountCents !== undefined) {
    return `Suggested ${formatBudgetCents(tick.amountCents)} on ${tick.side === "yes" ? "Yes" : "No"} — approve below`;
  }
  if (tick.action === "skip") return `Skipped: ${tick.reason ?? "the agent chose not to bet"}`;
  if (tick.action === "hold" && tick.reason !== undefined) return `Held: ${tick.reason}`;
  if (tick.action === "notify" && tick.fired.length === 0) return "Reviewed the market; no bet was proposed.";
  if (tick.fired.length > 0) return `Fired: ${firedLabels.join(", ")}`;
  const reasons = [...new Set(tick.skipped.map((item) => item.reason))];
  return reasons.length > 0
    ? `Nothing fired — ${reasons.join("; ")}`
    : "No watched condition is true right now";
}
