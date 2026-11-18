import { z } from "zod";

const nullableCents = z.number().nullable();

const feedMarket = z.object({
  eventTicker: z.string(),
  eventTitle: z.string(),
  contractLabel: z.string(),
  instrumentSymbol: z.string(),
  yesCents: nullableCents,
  noCents: nullableCents,
  marketState: z.string(),
  category: z.string(),
  impliedYesPercent: nullableCents,
  bestBidCents: nullableCents,
  bestAskCents: nullableCents,
  lastTradeCents: nullableCents,
  tradeable: z.boolean(),
  tradeBlockedReason: z.string().optional(),
});

const matchedBy = z.enum(["grok", "keywords"]);

export const feedMatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("matched"),
    postId: z.string(),
    matchedBy,
    confidence: z.number(),
    why: z.string(),
    market: feedMarket,
  }),
  z.object({ kind: z.literal("no-match"), postId: z.string(), matchedBy, reason: z.string() }),
]);

export const feedQuoteSchema = z.object({
  market: feedMarket,
  history: z.array(z.object({ at: z.string(), yesCents: z.number() })),
});

export const decisionEntrySchema = z.object({
  entryId: z.string(),
  kind: z.enum(["approve", "needs-approval", "refuse", "execution-failed"]),
  code: z.string().optional(),
  spokenReason: z.string(),
  intentId: z.string(),
  symbol: z.string(),
  outcome: z.enum(["yes", "no"]),
  notionalCents: z.number(),
  explorerUrl: z.string().optional(),
  signature: z.string().optional(),
  ticket: z
    .object({ ticketId: z.string(), symbol: z.string(), outcome: z.enum(["yes", "no"]), quantity: z.string(), price: z.string(), mode: z.literal("paper") })
    .optional(),
});

export const entryResponseSchema = z.object({ entry: decisionEntrySchema });

export type WireMatch = z.output<typeof feedMatchSchema>;
export type WireMatched = Extract<WireMatch, { kind: "matched" }>;
export type WireMarket = z.output<typeof feedMarket>;
export type WireQuote = z.output<typeof feedQuoteSchema>;
export type WireEntry = z.output<typeof decisionEntrySchema>;
