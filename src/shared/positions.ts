import { z } from "zod";

const positionStatus = z.enum(["open", "closed", "settled", "unavailable"]);

const fill = z.object({
  entryId: z.string(),
  at: z.string(),
  contracts: z.number(),
  costCents: z.number(),
  priceCents: z.number(),
  signature: z.string().nullable(),
  explorerUrl: z.string().nullable(),
});

const position = z.object({
  symbol: z.string(),
  outcome: z.enum(["yes", "no"]),
  eventTitle: z.string().nullable(),
  contractLabel: z.string().nullable(),
  contracts: z.number(),
  averageEntryCents: z.number(),
  costCents: z.number(),
  currentCents: z.number().nullable(),
  markAgeSeconds: z.number().nullable(),
  valueCents: z.number().nullable(),
  pnlCents: z.number().nullable(),
  pnlPercent: z.number().nullable(),
  status: positionStatus,
  fills: z.array(fill),
});

const researchPurchase = z.object({
  entryId: z.string(),
  at: z.string(),
  symbol: z.string(),
  costCents: z.number(),
  signature: z.string().nullable(),
  explorerUrl: z.string().nullable(),
});

export const positionsViewSchema = z.object({
  generatedAt: z.string(),
  researchSpend: z.object({ todayCents: z.number(), purchases: z.array(researchPurchase) }),
  positions: z.array(position),
  totals: z.object({
    costCents: z.number(),
    pricedCostCents: z.number(),
    valueCents: z.number(),
    pnlCents: z.number(),
    pnlPercent: z.number().nullable(),
    unpricedPositions: z.number(),
  }),
});

export type PositionsView = z.output<typeof positionsViewSchema>;
export type PositionView = z.output<typeof position>;
export type PositionFillView = z.output<typeof fill>;
export type PositionStatus = z.output<typeof positionStatus>;
export type ResearchPurchaseView = z.output<typeof researchPurchase>;

export const feedPositionsSchema = z.object({
  positions: z.array(position.pick({
    symbol: true,
    outcome: true,
    eventTitle: true,
    contractLabel: true,
    contracts: true,
    averageEntryCents: true,
    currentCents: true,
    pnlCents: true,
    pnlPercent: true,
  }).extend({
    explorerUrl: z.string().nullable(),
    researchPath: z.string().regex(/^\/markets\/[A-Za-z0-9%_-]+$/u),
  })),
  totals: positionsViewSchema.shape.totals,
  budget: z.object({
    dailyCapCents: z.number(),
    spentCents: z.number(),
    remainingCents: z.number(),
    researchSpentCents: z.number(),
    perTradeMaxCents: z.number().int().nonnegative(),
    autoApproveMaxCents: z.number().int().nonnegative(),
  }),
});

export type FeedPositions = z.output<typeof feedPositionsSchema>;

export const portfolioRangeSchema = z.enum(["7d", "30d", "90d", "all"]);
export type PortfolioRange = z.output<typeof portfolioRangeSchema>;

const signedCents = z.number();

const portfolioStat = z.object({
  valueCents: signedCents,
  valuePercent: z.number().nullable(),
  detail: z.string(),
});

export const portfolioViewSchema = z.object({
  generatedAt: z.string(),
  range: portfolioRangeSchema,
  rangeStart: z.string(),
  rangeEnd: z.string(),
  dailyCapCents: z.number().int().nonnegative(),
  marksNote: z.string().nullable(),
  stats: z.object({
    totalPnl: portfolioStat,
    openValue: portfolioStat,
    realizedPnl: portfolioStat,
    winRate: z.object({
      percent: z.number().nullable(),
      wins: z.number().int().nonnegative(),
      settled: z.number().int().nonnegative(),
      detail: z.string(),
    }),
    returnOnSpend: z.object({
      percent: z.number().nullable(),
      detail: z.string(),
    }),
    researchSpend: portfolioStat,
  }),
  pnlSeries: z.array(z.object({
    at: z.string(),
    label: z.string(),
    totalPnlCents: signedCents,
    researchSpendCents: z.number(),
    carried: z.boolean(),
  })),
  dailySpend: z.object({
    days: z.array(z.object({
      day: z.string(),
      label: z.string(),
      betsCents: z.number(),
      briefsCents: z.number(),
    })),
    windowLabel: z.string(),
    caption: z.string(),
    resetNote: z.string(),
  }),
  openPositions: z.object({
    rows: z.array(z.object({
      symbol: z.string(),
      eventTitle: z.string(),
      contractLabel: z.string().nullable(),
      outcome: z.enum(["yes", "no"]),
      placedBy: z.string(),
      shares: z.number(),
      averageEntryCents: z.number(),
      markCents: z.number().nullable(),
      valueCents: z.number().nullable(),
      pnlCents: z.number().nullable(),
      ifRightCents: z.number(),
      ends: z.string().nullable(),
      markAgeSeconds: z.number().nullable(),
    })),
    openCount: z.number().int().nonnegative(),
    valueCents: z.number(),
    unpriced: z.number().int().nonnegative(),
  }),
  categories: z.object({
    rows: z.array(z.object({
      category: z.string(),
      pnlCents: signedCents,
    })),
    caption: z.string().nullable(),
  }),
  calibration: z.object({
    settledBets: z.number().int().nonnegative(),
    empty: z.string().nullable(),
    buckets: z.array(z.object({
      label: z.string(),
      bets: z.number().int().nonnegative(),
      wins: z.number().int().nonnegative(),
      winRatePercent: z.number(),
      impliedPercent: z.number(),
    })),
  }),
  activity: z.array(z.object({
    id: z.string(),
    at: z.string(),
    type: z.enum(["bet", "brief", "payout"]),
    market: z.string(),
    symbol: z.string(),
    side: z.enum(["yes", "no"]).nullable(),
    placedBy: z.string(),
    detail: z.string(),
    amountCents: signedCents,
    ticketId: z.string().nullable(),
    ticket: z.object({
      ticketId: z.string(),
      symbol: z.string(),
      outcome: z.enum(["yes", "no"]),
      quantity: z.string(),
      price: z.string(),
      mode: z.literal("paper"),
    }).nullable(),
    signature: z.string().nullable(),
    explorerUrl: z.string().nullable(),
  })),
});

export type PortfolioView = z.output<typeof portfolioViewSchema>;
export type PortfolioActivity = PortfolioView["activity"][number];
export type PortfolioStat = z.output<typeof portfolioStat>;
