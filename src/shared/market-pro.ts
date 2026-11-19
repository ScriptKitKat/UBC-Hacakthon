import { z } from "zod";

export const PRO_TIMEFRAMES = ["5m", "1h", "4h", "1D", "1W"] as const;
export type ProTimeframe = (typeof PRO_TIMEFRAMES)[number];

export function isProTimeframe(value: string): value is ProTimeframe {
  return (PRO_TIMEFRAMES as readonly string[]).includes(value);
}

const cents = z.number().nullable();

const unavailable = z.object({
  kind: z.literal("unavailable"),
  reason: z.string(),
});

const shown = z.object({
  kind: z.literal("value"),
  text: z.string(),
  tone: z.enum(["up", "down", "neutral"]),
});

export const proStatSchema = z.discriminatedUnion("kind", [shown, unavailable]);
export type ProStat = z.output<typeof proStatSchema>;

export const proCandleSchema = z.object({
  timeMs: z.number(),
  openCents: z.number(),
  highCents: z.number(),
  lowCents: z.number(),
  closeCents: z.number(),
  volume: z.number(),
});
export type ProCandle = z.output<typeof proCandleSchema>;

export const proOverlayPointSchema = z.object({
  timeMs: z.number(),
  price: z.number(),
});
export type ProOverlayPoint = z.output<typeof proOverlayPointSchema>;

export const proBandPointSchema = z.object({
  timeMs: z.number(),
  ma7: cents,
  ma20: cents,
  upper: cents,
  lower: cents,
  rsi: cents,
});
export type ProBandPoint = z.output<typeof proBandPointSchema>;

export const proIndicatorRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  signal: z.string().nullable(),
  tone: z.enum(["up", "down", "warn", "neutral"]),
  missing: z.string().nullable(),
});
export type ProIndicatorRow = z.output<typeof proIndicatorRowSchema>;

export const proLadderRungSchema = z.object({
  symbol: z.string(),
  strikeLabel: z.string(),
  strikeValue: z.number().nullable(),
  yesCents: cents,
  changeCents: cents,
  current: z.boolean(),
  href: z.string(),
});
export type ProLadderRung = z.output<typeof proLadderRungSchema>;

export const proBookLevelSchema = z.object({
  priceCents: z.number(),
  amount: z.number(),
  notional: z.number(),
  cumulative: z.number(),
});
export type ProBookLevel = z.output<typeof proBookLevelSchema>;

export const proTradeSchema = z.object({
  tradeId: z.number(),
  timeMs: z.number(),
  priceCents: z.number(),
  amount: z.number(),
  side: z.enum(["buy", "sell"]),
});
export type ProTrade = z.output<typeof proTradeSchema>;

export const proFeedItemSchema = z.object({
  id: z.string(),
  timeMs: z.number().nullable(),
  source: z.string(),
  event: z.string(),
  url: z.string().nullable(),
  oddsChangeCents: cents,
});
export type ProFeedItem = z.output<typeof proFeedItemSchema>;

export const proPositionSchema = z.object({
  outcome: z.enum(["yes", "no"]),
  contracts: z.number(),
  averageEntryCents: z.number(),
  markCents: cents,
  costCents: z.number(),
  pnlCents: cents,
  pnlPercent: cents,
  ifYesCents: z.number(),
  ifNoCents: z.number(),
});
export type ProPosition = z.output<typeof proPositionSchema>;

export const proBudgetSchema = z.object({
  dailyCapCents: z.number(),
  spentCents: z.number(),
  remainingCents: z.number(),
  perTradeMaxCents: z.number(),
  autoApproveMaxCents: z.number(),
  resetAt: z.string(),
  senderId: z.string().nullable(),
});
export type ProBudget = z.output<typeof proBudgetSchema>;

export const proSpotSchema = z.object({
  asset: z.string(),
  pair: z.string(),
  last: z.number(),
  strikeValue: z.number().nullable(),
  moveNeeded: z.number().nullable(),
});
export type ProSpot = z.output<typeof proSpotSchema>;

export const proFlowSchema = z.object({
  buyPercent: cents,
  sellPercent: cents,
  largeTradeCount: z.number().nullable(),
  largeTradeNetNotional: z.number().nullable(),
  averageTradeNotional: z.number().nullable(),
  sampleSize: z.number(),
  windowLabel: z.string(),
});
export type ProFlow = z.output<typeof proFlowSchema>;

export const proMarketSchema = z.object({
  symbol: z.string(),
  eventTicker: z.string(),
  eventTitle: z.string(),
  displayTitle: z.string(),
  contractLabel: z.string(),
  category: z.string(),
  subcategory: z.string().nullable(),
  expiryDate: z.string().nullable(),
  eventStatus: z.string(),
  marketState: z.string(),
  asset: z.string().nullable(),
  iconBackground: z.string(),
  yesAskCents: cents,
  noAskCents: cents,
  yesBidCents: cents,
  noBidCents: cents,
  lastTradeCents: cents,
  bestBidCents: cents,
  bestAskCents: cents,
  quantityLimits: z
    .object({
      quantityIncrementHundredths: z.number(),
      quantityMinimumHundredths: z.number(),
    })
    .nullable(),
});
export type ProMarket = z.output<typeof proMarketSchema>;

export const proChartSchema = z.object({
  timeframe: z.enum(PRO_TIMEFRAMES),
  candles: z.array(proCandleSchema),
  bands: z.array(proBandPointSchema),
  ma7Last: cents,
  ma20Last: cents,
  bbLower: cents,
  bbUpper: cents,
  rsiLast: cents,
  source: z.enum(["live", "unavailable"]),
  overlay: z
    .object({
      asset: z.string(),
      points: z.array(proOverlayPointSchema),
    })
    .nullable(),
});
export type ProChart = z.output<typeof proChartSchema>;

export const proStatsSchema = z.object({
  last: proStatSchema,
  change24h: proStatSchema,
  bidAsk: proStatSchema,
  highLow24h: proStatSchema,
  volume24h: proStatSchema,
  volumeTotal: proStatSchema,
  openInterest: proStatSchema,
  traders: proStatSchema,
  resolvesIn: proStatSchema,
  maxPayout: proStatSchema,
});
export type ProStats = z.output<typeof proStatsSchema>;

export const proBookSchema = z.object({
  bids: z.array(proBookLevelSchema),
  asks: z.array(proBookLevelSchema),
  midCents: cents,
  spreadCents: cents,
  slippage500Cents: cents,
  depthPlusMinus5: cents,
  source: z.enum(["live", "unavailable"]),
});
export type ProBook = z.output<typeof proBookSchema>;

export const proShellSchema = z.object({
  generatedAt: z.string(),
  market: proMarketSchema,
  stats: proStatsSchema,
  chart: proChartSchema,
  ladder: z.array(proLadderRungSchema),
  spot: proSpotSchema.nullable(),
  budget: proBudgetSchema,
  position: proPositionSchema.nullable(),
  watched: z.boolean(),
  freshness: z.enum(["live", "stale"]),
});
export type ProShell = z.output<typeof proShellSchema>;

export const proLiveSchema = z.object({
  generatedAt: z.string(),
  book: proBookSchema,
  trades: z.object({
    items: z.array(proTradeSchema),
    source: z.enum(["live", "unavailable"]),
  }),
  indicators: z.array(proIndicatorRowSchema),
  flow: proFlowSchema.nullable(),
  feed: z.array(proFeedItemSchema),
  position: proPositionSchema.nullable(),
  budget: proBudgetSchema,
  watched: z.boolean(),
});
export type ProLive = z.output<typeof proLiveSchema>;

export const GEMINI_UNAVAILABLE_REASON = "Not available from Gemini";
