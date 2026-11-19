import type { FeedPositions } from "@/shared";
import { MAX_FEED_BUY_CENTS } from "@/shared";
import { z } from "zod";
import type { WireEntry, WireMatch, WireQuote } from "./wire";

export const backgroundRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("match"),
    postId: z.string().min(1),
    text: z.string().min(1).max(2000),
    author: z.string().optional(),
    url: z.string().optional(),
  }),
  z.object({ type: z.literal("positions") }),
  z.object({ type: z.literal("quote"), symbol: z.string().min(1) }),
  z.object({
    type: z.literal("buy"),
    postId: z.string().min(1),
    instrumentSymbol: z.string().min(1),
    outcome: z.enum(["yes", "no"]),
    amountCents: z.number().int().positive().max(MAX_FEED_BUY_CENTS),
    clientOrderId: z.uuid(),
    seenPriceCents: z.number().int().min(1).max(100).optional(),
  }),
  z.object({ type: z.literal("confirm"), intentId: z.string().min(1) }),
]);

export type BackgroundRequest = z.output<typeof backgroundRequestSchema>;

export interface ReplyValues {
  readonly match: WireMatch;
  readonly quote: WireQuote;
  readonly positions: FeedPositions;
  readonly buy: WireEntry;
  readonly confirm: WireEntry;
}

export type BackgroundReply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type Sender = <K extends BackgroundRequest["type"]>(
  request: Extract<BackgroundRequest, { type: K }>,
) => Promise<BackgroundReply<ReplyValues[K]>>;
