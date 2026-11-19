import { z } from "zod";

export const catalogCardSchema = z.object({
  eventTicker: z.string(),
  eventTitle: z.string(),
  contractLabel: z.string(),
  instrumentSymbol: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  expiryDate: z.string().nullable(),
  endsIn: z.string().nullable(),
  yesCents: z.number().nullable(),
  noCents: z.number().nullable(),
  changePercent: z.number().nullable(),
  sparkline: z.array(z.number()),
  tradeable: z.boolean(),
  tradeBlockedReason: z.string().optional(),
});

export const catalogPageSchema = z.object({
  markets: z.array(catalogCardSchema),
  total: z.number().int().nonnegative(),
  categories: z.array(z.string()),
});

export const homeRailSchema = z.object({
  dailyCapCents: z.number(),
  spentCents: z.number(),
  remainingCents: z.number(),
  perTradeMaxCents: z.number(),
  autoApproveMaxCents: z.number(),
  killSwitch: z.boolean(),
  pendingCount: z.number().int().nonnegative(),
  senderAllowlist: z.array(z.string()),
  ledgerConfigured: z.boolean(),
  resetLabel: z.string(),
});

export const homeViewSchema = catalogPageSchema.extend({
  rail: homeRailSchema,
});

export type CatalogCard = z.output<typeof catalogCardSchema>;
export type CatalogPage = z.output<typeof catalogPageSchema>;
export type HomeRail = z.output<typeof homeRailSchema>;
export type HomeView = z.output<typeof homeViewSchema>;
