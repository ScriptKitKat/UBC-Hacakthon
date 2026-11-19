import type { MarketContract, MarketEvent } from "@/features/markets";
import type { ProLadderRung } from "@/shared";

function formatStrike(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (Number.isInteger(value)) return `$${String(value)}`;
  return `$${value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "")}`;
}

function rungLabel(contract: MarketContract): string {
  if (contract.strikeValue !== null && contract.strikeValue !== undefined) return formatStrike(contract.strikeValue);
  const named = contract.abbreviatedName?.trim() || contract.label.trim();
  return named === "" ? contract.instrumentSymbol : named;
}

export function strikeLadder(event: MarketEvent, currentSymbol: string): readonly ProLadderRung[] {
  const priced = event.contracts.filter((contract) => contract.prices.buyYesCents !== null || contract.strikeValue != null);
  if (priced.length <= 1) return [];
  const withStrike = priced.filter((contract) => contract.strikeValue != null);
  const source = withStrike.length > 1 ? withStrike : priced;
  return [...source]
    .sort((a, b) => {
      const left = a.strikeValue;
      const right = b.strikeValue;
      if (left != null && right != null && left !== right) return left - right;
      return a.instrumentSymbol.localeCompare(b.instrumentSymbol);
    })
    .map((contract) => ({
      symbol: contract.instrumentSymbol,
      strikeLabel: rungLabel(contract),
      strikeValue: contract.strikeValue ?? null,
      yesCents: contract.prices.buyYesCents,
      changeCents: null,
      current: contract.instrumentSymbol === currentSymbol,
      href: `/markets/${encodeURIComponent(contract.instrumentSymbol)}?view=pro`,
    }));
}
