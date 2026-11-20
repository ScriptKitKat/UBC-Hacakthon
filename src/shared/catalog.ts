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
  imageUrl: z.string().nullable(),
  yesCents: z.number().nullable(),
  yesAskCents: z.number().nullable(),
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
  stale: z.boolean().optional(),
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
  resetAt: z.string(),
  resetLabel: z.string(),
});

export const homeViewSchema = catalogPageSchema.extend({
  rail: homeRailSchema,
});

export type CatalogCard = z.output<typeof catalogCardSchema>;
export type CatalogPage = z.output<typeof catalogPageSchema>;
export type HomeRail = z.output<typeof homeRailSchema>;
export type HomeView = z.output<typeof homeViewSchema>;


export const browseSortSchema = z.enum(["trending", "closing", "newest", "move"]);
export type BrowseSort = z.output<typeof browseSortSchema>;

export const browseRowSchema = z.object({
  instrumentSymbol: z.string(),
  label: z.string(),
  yesCents: z.number().nullable(),
  payoutBeginner: z.string().nullable(),
  payoutPro: z.string().nullable(),
  href: z.string(),
});

export const browseCardSchema = z.object({
  eventTicker: z.string(),
  eventTitle: z.string(),
  displayTitle: z.string(),
  instrumentSymbol: z.string(),
  href: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  kind: z.enum(["sports", "crypto", "binary", "other"]),
  isLive: z.boolean(),
  when: z.string().nullable(),
  spotLabel: z.string().nullable(),
  imageUrl: z.string().nullable(),
  volume: z.number().nullable(),
  volumeLabel: z.string().nullable(),
  moreCount: z.number().int().nonnegative(),
  rows: z.array(browseRowSchema),
  changePercent: z.number().nullable(),
  createdAt: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const browseTabSchema = z.object({
  id: z.string(),
  label: z.string(),
  live: z.boolean(),
});

export const browsePageSchema = z.object({
  markets: z.array(browseCardSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  tabs: z.array(browseTabSchema),
  stale: z.boolean().optional(),
});

export type BrowseRow = z.output<typeof browseRowSchema>;
export type BrowseCard = z.output<typeof browseCardSchema>;
export type BrowseTab = z.output<typeof browseTabSchema>;
export type BrowsePage = z.output<typeof browsePageSchema>;


export const watchlistItemSchema = z.object({
  eventTicker: z.string().min(1),
  instrumentSymbol: z.string().min(1).nullable(),
  savedAt: z.string().nullable(),
  savedYesCents: z.number().nullable(),
});

export const watchlistCardSchema = catalogCardSchema.extend({
  savedAt: z.string().nullable(),
  savedYesCents: z.number().nullable(),
  todayPoints: z.number().nullable(),
  status: z.enum(["live", "ended", "settled"]),
  href: z.string(),
});

export const watchlistViewSchema = z.object({
  symbols: z.array(z.string()),
  items: z.array(watchlistItemSchema),
  cards: z.array(watchlistCardSchema).optional(),
});

export type WatchlistItemView = z.output<typeof watchlistItemSchema>;
export type WatchlistCard = z.output<typeof watchlistCardSchema>;
export type WatchlistView = z.output<typeof watchlistViewSchema>;
