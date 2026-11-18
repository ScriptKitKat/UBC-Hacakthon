import type { WireEntry, WireMarket, WireMatched, WireQuote } from "./wire";

export const market: WireMarket = {
  eventTicker: "FED261211",
  eventTitle: "Fed decision in December?",
  contractLabel: "Fed maintains rate",
  instrumentSymbol: "GEMI-FED261211-MAINTAIN",
  yesCents: 62,
  noCents: 40,
  marketState: "open",
  category: "Economics",
  impliedYesPercent: 62,
  bestBidCents: 60,
  bestAskCents: 62,
  lastTradeCents: 62,
  tradeable: true,
};

export const matched: WireMatched = {
  kind: "matched",
  postId: "2122621916934500390",
  matchedBy: "grok",
  confidence: 0.9,
  why: "Powell signalling a hold makes a December rate cut less likely.",
  market,
};

export const quote: WireQuote = {
  market: { ...market, yesCents: 65, noCents: 37, impliedYesPercent: 65 },
  history: [
    { at: "2026-11-17T12:00:00.000Z", yesCents: 60 },
    { at: "2026-11-17T12:00:20.000Z", yesCents: 62 },
    { at: "2026-11-17T12:00:40.000Z", yesCents: 65 },
  ],
};

export function entry(overrides: Partial<WireEntry> = {}): WireEntry {
  return {
    entryId: "e1",
    kind: "approve",
    spokenReason: "I approved the $1 trade.",
    intentId: "intent-1",
    symbol: market.instrumentSymbol,
    outcome: "yes",
    notionalCents: 100,
    explorerUrl: "https://explorer.solana.com/tx/sig?cluster=devnet",
    signature: "sig",
    ticket: { ticketId: "ticket-12345678", symbol: market.instrumentSymbol, outcome: "yes", quantity: "1.61", price: "0.62", mode: "paper" },
    ...overrides,
  };
}
