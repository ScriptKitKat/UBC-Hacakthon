import { MAX_FEED_BUY_CENTS } from "@/shared";
import { formatUsdc } from "./format";

export interface TradeBudget {
  readonly perTradeMaxCents: number;
  readonly remainingCents: number;
  readonly autoApproveMaxCents: number;
}

function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function tradeBudgetFrom(budget: unknown): TradeBudget | undefined {
  if (typeof budget !== "object" || budget === null) return undefined;
  const { perTradeMaxCents, remainingCents, autoApproveMaxCents } = budget as Record<string, unknown>;
  if (typeof perTradeMaxCents !== "number" || typeof remainingCents !== "number" || typeof autoApproveMaxCents !== "number") return undefined;
  if (!isCents(perTradeMaxCents) || !isCents(remainingCents) || !isCents(autoApproveMaxCents)) return undefined;
  return { perTradeMaxCents, remainingCents, autoApproveMaxCents };
}

export function tradeCapCents(budget: TradeBudget | undefined): number {
  return budget === undefined
    ? MAX_FEED_BUY_CENTS
    : Math.max(0, Math.min(MAX_FEED_BUY_CENTS, budget.perTradeMaxCents, budget.remainingCents));
}

export function overTradeLimitMessage(amountCents: number, budget: TradeBudget | undefined): string | null {
  if (amountCents <= tradeCapCents(budget)) return null;
  if (budget === undefined) return `Maximum ${formatUsdc(MAX_FEED_BUY_CENTS)} per order.`;
  return `Over your limit: max ${formatUsdc(budget.perTradeMaxCents)} per trade (${formatUsdc(budget.remainingCents)} left today)`;
}

export function needsApprovalNote(amountCents: number, budget: TradeBudget | undefined): string | null {
  return budget !== undefined && amountCents <= tradeCapCents(budget) && amountCents > budget.autoApproveMaxCents
    ? "Needs approval"
    : null;
}
