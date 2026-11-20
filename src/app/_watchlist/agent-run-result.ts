export function agentRunResultText(
  tick: {
    readonly marketUnavailable?: boolean | undefined;
    readonly fired: readonly string[];
    readonly skipped: readonly { readonly reason: string }[];
  },
  firedLabels: readonly string[],
): string {
  if (tick.marketUnavailable === true) return "Couldn't load market data for this run.";
  if (tick.fired.length > 0) return `Fired: ${firedLabels.join(", ")}`;
  const reasons = [...new Set(tick.skipped.map((item) => item.reason))];
  return reasons.length > 0
    ? `Nothing fired — ${reasons.join("; ")}`
    : "No watched condition is true right now";
}
