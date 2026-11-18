import { z } from "zod";
import type { WireEntry, WireMatch, WireQuote } from "./wire";

export const AMOUNT_CHOICES_CENTS = [100, 200, 500] as const;

export const backgroundRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("match"),
    postId: z.string().min(1),
    text: z.string().min(1).max(2000),
    author: z.string().optional(),
    url: z.string().optional(),
  }),
  z.object({ type: z.literal("quote"), symbol: z.string().min(1) }),
  z.object({
    type: z.literal("buy"),
    postId: z.string().min(1),
    instrumentSymbol: z.string().min(1),
    outcome: z.enum(["yes", "no"]),
    amountCents: z.number().int().positive(),
  }),
  z.object({ type: z.literal("confirm"), intentId: z.string().min(1) }),
]);

export type BackgroundRequest = z.output<typeof backgroundRequestSchema>;

export interface ReplyValues {
  readonly match: WireMatch;
  readonly quote: WireQuote;
  readonly buy: WireEntry;
  readonly confirm: WireEntry;
}

export type BackgroundReply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type Sender = <K extends BackgroundRequest["type"]>(
  request: Extract<BackgroundRequest, { type: K }>,
) => Promise<BackgroundReply<ReplyValues[K]>>;
