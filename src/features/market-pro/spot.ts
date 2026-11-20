import type { MarketEvent } from "@/features/markets";
import type { ProSpot } from "@/shared";

const CRYPTO = "crypto";
export function tickerAsset(eventTicker: string): string | undefined {
  const match = /^([A-Z]+)/u.exec(eventTicker);
  return match?.[1];
}

export function isCryptoEvent(event: MarketEvent): boolean {
  return event.category.trim().toLowerCase() === CRYPTO;
}

export function spotPair(asset: string): string {
  return `${asset.toLowerCase()}usd`;
}

export function currentStrike(event: MarketEvent, symbol: string): number | null {
  return event.contracts.find((contract) => contract.instrumentSymbol === symbol)?.strikeValue ?? null;
}

export function buildSpot(input: {
  readonly event: MarketEvent;
  readonly symbol: string;
  readonly last: number | null;
}): ProSpot | null {
  if (!isCryptoEvent(input.event) || input.last === null || input.last <= 0) return null;
  const asset = tickerAsset(input.event.ticker);
  if (asset === undefined) return null;
  const strikeValue = currentStrike(input.event, input.symbol);
  const moveNeeded = strikeValue === null || strikeValue <= 0 ? null : (strikeValue - input.last) / input.last;
  return { asset, pair: spotPair(asset), last: input.last, strikeValue, moveNeeded };
}
