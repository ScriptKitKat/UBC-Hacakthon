import { MAX_FEED_BUY_CENTS } from "@/shared";

export interface TradeBudget {
  readonly perTradeMaxCents: number;
  readonly remainingCents: number;
  readonly autoApproveMaxCents: number;
}

export function tradeCapCents(budget: TradeBudget | undefined): number {
  return budget === undefined
    ? MAX_FEED_BUY_CENTS
    : Math.max(0, Math.min(MAX_FEED_BUY_CENTS, budget.perTradeMaxCents, budget.remainingCents));
}

export function overTradeLimitMessage(amountCents: number, budget: TradeBudget | undefined): string | null {
  if (amountCents <= tradeCapCents(budget)) return null;
  if (budget === undefined) return `Over your limit: max $${(MAX_FEED_BUY_CENTS / 100).toFixed(0)} per trade`;
  return `Over your limit: max $${dollars(budget.perTradeMaxCents)} per trade ($${dollars(budget.remainingCents)} left today)`;
}

export function needsApprovalNote(amountCents: number, budget: TradeBudget | undefined): string | null {
  return budget !== undefined && amountCents <= tradeCapCents(budget) && amountCents > budget.autoApproveMaxCents
    ? "Needs approval"
    : null;
}

function dollars(cents: number): string {
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
