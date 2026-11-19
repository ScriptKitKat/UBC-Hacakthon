import { z } from "zod";
import { instrumentSymbol } from "@/shared";
import type { BookLevel, Candle, EventsPage, MarketContract, MarketEvent, OrderBook, RecentTrade } from "./types";

const hundredths = z.string()
  .regex(/^\d+(?:\.\d{1,2}0*)?$/)
  .transform((text) => {
    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  });

const increment = hundredths.pipe(z.bigint().positive());
const optionalCents = hundredths.pipe(z.bigint().max(100n))
  .nullish().transform((cents) => cents == null ? null : Number(cents));

const pricesSchema = z
  .object({
    buy: z.object({ yes: optionalCents, no: optionalCents }).nullish(),
    sell: z.object({ yes: optionalCents, no: optionalCents }).nullish(),
    bestBid: optionalCents,
    bestAsk: optionalCents,
    lastTradePrice: optionalCents,
  })
  .nullish()
  .transform((prices) => ({
    bestBidCents: prices?.bestBid ?? null,
    bestAskCents: prices?.bestAsk ?? null,
    lastTradeCents: prices?.lastTradePrice ?? null,
    buyYesCents: prices?.buy?.yes ?? null,
    buyNoCents: prices?.buy?.no ?? null,
    sellYesCents: prices?.sell?.yes ?? null,
    sellNoCents: prices?.sell?.no ?? null,
  }));

interface RichTextNode {
  readonly value?: string | null | undefined;
  readonly content?: readonly RichTextNode[] | null | undefined;
}

const richTextNode: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({ value: z.string().nullish(), content: z.array(richTextNode).nullish() }),
);

const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/gu;

function flattenRichText(node: RichTextNode): string {
  return (node.value ?? "") + (node.content ?? []).map(flattenRichText).join(" ");
}

function plainText(text: string): string {
  return text.replace(MARKDOWN_LINK, "$1").replace(/\\([&_*[\]()])/gu, "$1").replace(/\s+/gu, " ").trim();
}

const descriptionSchema = z
  .union([z.string(), richTextNode])
  .nullish()
  .transform((description) => plainText(typeof description === "string" ? description : description ? flattenRichText(description) : ""));

const decimalNumber = z.union([z.string(), z.number()]).nullish().transform((value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
});


function parseStrikeValue(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const subcategorySchema = z.object({ name: z.string() }).nullish().transform((subcategory) => subcategory?.name ?? null);

const contractSchema = z
  .object({
    instrumentSymbol: z.string().min(1).transform(instrumentSymbol),
    label: z.string().nullish(),
    description: descriptionSchema,
    expiryDate: z.string().nullish(),
    resolutionSide: z.string().nullish(),
    abbreviatedName: z.string().nullish(),
    color: z.string().nullish(),
    createdAt: z.string().nullish(),
    strike: z.object({ value: z.union([z.string(), z.number()]).optional() }).nullish(),
    marketState: z.string(),
    status: z.string(),
    prices: pricesSchema,
    quantityIncrement: increment.nullish(),
    quantityMinimum: hundredths.nullish(),
    priceIncrement: increment.nullish(),
    priceMinimum: hundredths.nullish(),
  })
  .transform((raw, context): MarketContract => {
    const {
      quantityIncrement: quantityIncrementHundredths, quantityMinimum: quantityMinimumHundredths,
      priceIncrement: priceIncrementCents, priceMinimum: priceMinimumCents,
    } = raw;
    let limits: MarketContract["limits"] = null;
    if (quantityIncrementHundredths != null && quantityMinimumHundredths != null
      && priceIncrementCents != null && priceMinimumCents != null) {
      limits = { quantityIncrementHundredths, quantityMinimumHundredths, priceIncrementCents, priceMinimumCents };
    } else if ([quantityIncrementHundredths, quantityMinimumHundredths, priceIncrementCents, priceMinimumCents]
      .some((value) => value != null)) {
      context.addIssue({ code: "custom", message: "Order limits must be complete" });
      return z.NEVER;
    }
    return {
      instrumentSymbol: raw.instrumentSymbol,
      label: raw.label ?? raw.abbreviatedName ?? "",
      description: raw.description,
      expiryDate: raw.expiryDate ?? null,
      ...(raw.resolutionSide === "yes" || raw.resolutionSide === "no" ? { resolutionSide: raw.resolutionSide } : {}),
      marketState: raw.marketState,
      status: raw.status,
      prices: raw.prices,
      limits,
      abbreviatedName: raw.abbreviatedName ?? null,
      color: raw.color ?? null,
      strikeValue: parseStrikeValue(raw.strike?.value),
      createdAt: raw.createdAt ?? null,
    };
  });

export const eventSchema = z
  .object({
    ticker: z.string().min(1),
    slug: z.string().optional(),
    title: z.string(),
    category: z.string().nullish(),
    status: z.string(),
    expiryDate: z.string().nullish(),
    description: descriptionSchema,
    subcategory: subcategorySchema,
    volume: decimalNumber,
    volume24h: decimalNumber,
    tags: z.array(z.string()).nullish(),
    contracts: z.array(contractSchema).nullish(),
    isLive: z.boolean().nullish(),
    createdAt: z.string().nullish(),
    startTime: z.string().nullish(),
  })
  .transform(
    (raw): MarketEvent => ({
      ticker: raw.ticker,
      ...(raw.slug === undefined ? {} : { slug: raw.slug }),
      title: raw.title,
      category: raw.category ?? "",
      status: raw.status,
      expiryDate: raw.expiryDate ?? null,
      description: raw.description,
      subcategory: raw.subcategory,
      volume: raw.volume,
      volume24h: raw.volume24h,
      tags: raw.tags ?? [],
      contracts: raw.contracts ?? [],
      isLive: raw.isLive === true,
      createdAt: raw.createdAt ?? null,
      startTime: raw.startTime ?? null,
    }),
  );

export const eventsPageSchema = z
  .object({
    data: z.array(eventSchema),
    pagination: z.object({ total: z.number() }),
  })
  .transform((raw): EventsPage => ({ events: raw.data, total: raw.pagination.total }));

const MAX_DATE_MS = 8_640_000_000_000_000;
const decimalText = z.string().regex(/^\d+(?:\.\d+)?$/);
const timestampMs = z.number().int().nonnegative().max(MAX_DATE_MS);
const dollarsToCents = z.number().nonnegative().max(1).transform((dollars) => Math.round(dollars * 10000) / 100);
const priceText = decimalText.transform(Number).pipe(z.number().max(1)).transform((dollars) => Math.round(dollars * 10000) / 100);
const amountText = decimalText.transform(Number).pipe(z.number());

export const candlesSchema = z
  .array(z.tuple([timestampMs, dollarsToCents, dollarsToCents, dollarsToCents, dollarsToCents, z.number().nonnegative()]))
  .transform((rows): Candle[] =>
    rows.map(([timeMs, openCents, highCents, lowCents, closeCents, volume]) => ({ timeMs, openCents, highCents, lowCents, closeCents, volume })),
  );

const bookLevel = z.object({ price: priceText, amount: amountText }).transform((level): BookLevel => ({ priceCents: level.price, amount: level.amount }));

export const orderBookSchema = z
  .object({ bids: z.array(bookLevel).nullish(), asks: z.array(bookLevel).nullish() })
  .transform((book): OrderBook => ({ bids: book.bids ?? [], asks: book.asks ?? [] }));

export const recentTradesSchema = z
  .array(z.object({ tid: z.number(), timestampms: timestampMs, price: priceText, amount: amountText, type: z.enum(["buy", "sell"]) }))
  .transform((rows): RecentTrade[] =>
    rows.map((row) => ({ tradeId: row.tid, timeMs: row.timestampms, priceCents: row.price, amount: row.amount, side: row.type })),
  );

export const pubtickerSchema = z
  .object({
    last: z.string(),
    bid: z.string().optional(),
    ask: z.string().optional(),
  })
  .transform((raw, context) => {
    const last = Number(raw.last);
    if (!Number.isFinite(last) || last <= 0) {
      context.addIssue({ code: "custom", message: "Ticker last price must be a positive number" });
      return z.NEVER;
    }
    return { last };
  });
