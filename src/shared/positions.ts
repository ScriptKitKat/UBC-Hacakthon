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
