import type { PositionView, ProPosition } from "@/shared";

export function positionFor(positions: readonly PositionView[], symbol: string): ProPosition | null {
  const open = positions.filter((position) => position.symbol === symbol && position.status === "open");
  const held = open[0];
  if (held === undefined) return null;
  const contracts = held.contracts;
  const cost = held.costCents;
  const ifYes = held.outcome === "yes" ? contracts * 100 - cost : -cost;
  const ifNo = held.outcome === "no" ? contracts * 100 - cost : -cost;
  return {
    outcome: held.outcome,
    contracts,
    averageEntryCents: held.averageEntryCents,
    markCents: held.currentCents,
    costCents: cost,
    pnlCents: held.pnlCents,
    pnlPercent: held.pnlPercent,
    ifYesCents: ifYes,
    ifNoCents: ifNo,
  };
}
