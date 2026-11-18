import { z } from "zod";
import { instrumentSymbol } from "@/shared";
import type { EventsPage, MarketContract, MarketEvent } from "./types";

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
  }));

const contractSchema = z
  .object({
    instrumentSymbol: z.string().min(1).transform(instrumentSymbol),
    label: z.string().nullish(),
    abbreviatedName: z.string().nullish(),
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
      marketState: raw.marketState,
      status: raw.status,
      prices: raw.prices,
      limits,
    };
  });

export const eventSchema = z
  .object({
    ticker: z.string().min(1),
    title: z.string(),
    category: z.string().nullish(),
    status: z.string(),
    expiryDate: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    contracts: z.array(contractSchema).nullish(),
  })
  .transform(
    (raw): MarketEvent => ({
      ticker: raw.ticker,
      title: raw.title,
      category: raw.category ?? "",
      status: raw.status,
      expiryDate: raw.expiryDate ?? null,
      tags: raw.tags ?? [],
      contracts: raw.contracts ?? [],
    }),
  );

export const eventsPageSchema = z
  .object({
    data: z.array(eventSchema),
    pagination: z.object({ total: z.number() }),
  })
  .transform((raw): EventsPage => ({ events: raw.data, total: raw.pagination.total }));
