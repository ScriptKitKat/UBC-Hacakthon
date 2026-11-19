import type { BookLevel, OrderBook } from "@/features/markets";
import type { ProBook, ProBookLevel } from "@/shared";

const SLIPPAGE_DOLLARS = 500;
const DEPTH_BAND_CENTS = 5;

function notionalOf(level: BookLevel): number {
  return (level.priceCents / 100) * level.amount;
}

function withCumulative(levels: readonly BookLevel[]): ProBookLevel[] {
  let cumulative = 0;
  return levels.map((level) => {
    const notional = notionalOf(level);
    cumulative += notional;
    return { priceCents: level.priceCents, amount: level.amount, notional, cumulative };
  });
}

export function midCents(book: OrderBook): number | null {
  const bid = book.bids[0]?.priceCents;
  const ask = book.asks[0]?.priceCents;
  if (bid === undefined && ask === undefined) return null;
  if (bid === undefined) return ask ?? null;
  if (ask === undefined) return bid;
  return (bid + ask) / 2;
}

export function spreadCents(book: OrderBook): number | null {
  const bid = book.bids[0]?.priceCents;
  const ask = book.asks[0]?.priceCents;
  if (bid === undefined || ask === undefined) return null;
  return ask - bid;
}

export function slippageForNotional(asks: readonly BookLevel[], dollars: number): number | null {
  if (asks.length === 0 || dollars <= 0) return null;
  const best = asks[0]?.priceCents;
  if (best === undefined) return null;
  let remaining = dollars;
  let cost = 0;
  let shares = 0;
  for (const level of asks) {
    const price = level.priceCents / 100;
    if (price <= 0) continue;
    const available = notionalOf(level);
    const take = Math.min(remaining, available);
    const fillShares = take / price;
    cost += take;
    shares += fillShares;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  if (remaining > 1e-6 || shares <= 0) return null;
  const averageCents = (cost / shares) * 100;
  return Math.round((averageCents - best) * 10) / 10;
}

export function depthWithin(book: OrderBook, bandCents: number, mid: number | null): number | null {
  if (mid === null) return null;
  const inBand = (level: BookLevel) => Math.abs(level.priceCents - mid) <= bandCents;
  const total = [...book.bids.filter(inBand), ...book.asks.filter(inBand)].reduce((sum, level) => sum + notionalOf(level), 0);
  return total;
}

export function buildBook(book: OrderBook | null): ProBook {
  if (book === null) {
    return {
      bids: [],
      asks: [],
      midCents: null,
      spreadCents: null,
      slippage500Cents: null,
      depthPlusMinus5: null,
      source: "unavailable",
    };
  }
  const mid = midCents(book);
  return {
    bids: withCumulative(book.bids),
    asks: withCumulative(book.asks),
    midCents: mid,
    spreadCents: spreadCents(book),
    slippage500Cents: slippageForNotional(book.asks, SLIPPAGE_DOLLARS),
    depthPlusMinus5: depthWithin(book, DEPTH_BAND_CENTS, mid),
    source: "live",
  };
}
