import { z } from "zod";
import { instrumentSymbol } from "@/shared";
import type { EventsPage, MarketContract, MarketEvent } from "./types";

const dollarsToCents = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform((text) => Math.round(Number(text) * 100));

const optionalCents = dollarsToCents.nullish().transform((cents) => cents ?? null);

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
  })
  .transform(
    (raw): MarketContract => ({
      instrumentSymbol: raw.instrumentSymbol,
      label: raw.label ?? raw.abbreviatedName ?? "",
      marketState: raw.marketState,
      status: raw.status,
      prices: raw.prices,
    }),
  );

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
