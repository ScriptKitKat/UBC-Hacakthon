import { z } from "zod";
import { briefAuthorSchema, briefEvidenceSchema } from "./brief-record";

export const RESEARCH_TIMEFRAMES = ["1H", "1D", "1W", "1M", "All"] as const;
export type ResearchTimeframe = (typeof RESEARCH_TIMEFRAMES)[number];

const cents = z.number().nullable();

const seriesPoint = z.object({
  t: z.number(),
  cents: z.number(),
  volume: z.number().nullable(),
  source: z.enum(["gemini", "trades", "snapshot"]),
  bidCents: cents,
  askCents: cents,
  ma: cents,
  upper: cents,
  lower: cents,
});

const depthLevel = z.object({ priceCents: z.number(), amount: z.number(), cumulative: z.number() });

const trade = z.object({
  tradeId: z.number(),
  timeMs: z.number(),
  priceCents: z.number(),
  amount: z.number(),
  side: z.enum(["buy", "sell"]),
});

const relatedContract = z.object({
  symbol: z.string(),
  eventTitle: z.string(),
  contractLabel: z.string(),
  yesCents: cents,
  noCents: cents,
});

const postContext = z.object({
  source: z.enum(["x-feed", "news"]),
  text: z.string(),
  author: z.string().nullable(),
  url: z.string().nullable(),
  why: z.string().nullable(),
  atMs: z.number().nullable(),
});

export const indicatorsSchema = z.object({
  momentum: z.object({
    value: z.number().nullable(),
    zone: z.enum(["overbought", "oversold", "neutral"]).nullable(),
    reading: z.string(),
  }),
  jumpiness: z.object({
    value: z.number().nullable(),
    mean: z.number().nullable(),
    upper: z.number().nullable(),
    lower: z.number().nullable(),
    outsideBand: z.boolean(),
    reading: z.string(),
  }),
  volumeSpike: z.object({
    ratio: z.number().nullable(),
    obvTrend: z.enum(["up", "down", "flat"]).nullable(),
    reading: z.string(),
  }),
  averagePrice: z.object({ value: z.number().nullable(), window: z.number(), reading: z.string() }),
  recentMove: z.object({ hourCents: z.number().nullable(), dayCents: z.number().nullable(), reading: z.string() }),
});

export const researchViewSchema = z.object({
  symbol: z.string(),
  generatedAt: z.string(),
  timeframe: z.enum(RESEARCH_TIMEFRAMES),
  market: z.object({
    eventTicker: z.string(),
    eventTitle: z.string(),
    contractLabel: z.string(),
    category: z.string(),
    subcategory: z.string().nullable(),
    expiryDate: z.string().nullable(),
    eventStatus: z.string(),
    marketState: z.string(),
    rulesText: z.string(),
    imageUrl: z.string().nullable(),
    termsLink: z.string().nullable(),
    volume: z.number().nullable(),
    volume24h: z.number().nullable(),
    quantityLimits: z.object({ quantityIncrementHundredths: z.number(), quantityMinimumHundredths: z.number() }).nullable(),
    prices: z.object({
      buyYesCents: cents,
      buyNoCents: cents,
      sellYesCents: cents,
      sellNoCents: cents,
      bestBidCents: cents,
      bestAskCents: cents,
      lastTradeCents: cents,
    }),
  }),
  data: z.object({
    event: z.enum(["live", "stale"]),
    candles: z.enum(["live", "unavailable"]),
    book: z.enum(["live", "unavailable"]),
    trades: z.enum(["live", "unavailable"]),
  }),
  series: z.object({
    source: z.enum(["gemini", "trades", "snapshot", "mixed", "none"]),
    points: z.array(seriesPoint),
  }),
  book: z.object({ bids: z.array(depthLevel), asks: z.array(depthLevel) }),
  trades: z.array(trade),
  indicators: indicatorsSchema,
  related: z.object({ sameEvent: z.array(relatedContract), sameCategory: z.array(relatedContract) }),
  postContext: postContext.nullable(),
  matchedPosts: z.array(postContext),
});

export type ResearchView = z.output<typeof researchViewSchema>;
export type ResearchIndicators = z.output<typeof indicatorsSchema>;
export type ResearchSeriesPoint = z.output<typeof seriesPoint>;
export type ResearchPostContext = z.output<typeof postContext>;
export type ResearchRelatedContract = z.output<typeof relatedContract>;
export type ResearchDepthLevel = z.output<typeof depthLevel>;
export type ResearchTrade = z.output<typeof trade>;

export function isResearchTimeframe(value: string): value is ResearchTimeframe {
  return (RESEARCH_TIMEFRAMES as readonly string[]).includes(value);
}

export const BRIEF_SECTION_TITLES = [
  "What the market thinks",
  "What changed recently",
  "Crowd and liquidity",
  "Related markets",
  "What would move it",
  "Risks / what this doesn't know",
] as const;

export const researchBriefSchema = z.object({
  symbol: z.string(),
  generatedAt: z.string(),
  headline: z.string(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
  polishedBy: z.enum(["template", "grok", "claude"]),
  author: briefAuthorSchema.optional(),
  evidence: briefEvidenceSchema.optional(),
});

const deepDiveStep = z.discriminatedUnion("step", [
  z.object({ step: z.literal("requirements"), detail: z.string() }),
  z.object({ step: z.literal("guardrails"), detail: z.string(), remainingCents: z.number() }),
  z.object({ step: z.literal("signed"), detail: z.string(), signature: z.string() }),
  z.object({ step: z.literal("settled"), detail: z.string(), signature: z.string(), explorerUrl: z.string() }),
  z.object({ step: z.literal("brief"), detail: z.string() }),
]);

export const deepDiveResultSchema = z.object({
  status: z.enum(["delivered", "refused", "failed"]),
  alreadyPurchased: z.boolean(),
  trace: z.array(deepDiveStep),
  failureReason: z.string().nullable(),
  brief: researchBriefSchema.nullable(),
  purchase: z.object({ at: z.string(), signature: z.string(), explorerUrl: z.string(), costCents: z.number() }).nullable(),
});

export type ResearchBrief = z.output<typeof researchBriefSchema>;
export type DeepDiveStep = z.output<typeof deepDiveStep>;
export type DeepDiveResult = z.output<typeof deepDiveResultSchema>;
