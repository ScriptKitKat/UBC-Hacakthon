import { z } from "zod";
import { usdToCents } from "./amount";

export const VOICE_TOOL_NAMES = ["get_market_quote", "propose_trade", "approve_pending_trade", "get_desk_status"] as const;

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

export const TRADE_TOOL_NAMES: readonly VoiceToolName[] = ["propose_trade", "approve_pending_trade"];

export function isVoiceToolName(value: string): value is VoiceToolName {
  return VOICE_TOOL_NAMES.some((name) => name === value);
}

const amountUsd = z
  .number()
  .describe("Dollar amount to bet, a positive number with at most two decimals, for example 2 or 2.5.")
  .transform((dollars, context) => {
    const cents = usdToCents(dollars);
    if (cents === undefined) {
      context.addIssue({ code: "custom", message: "must be a positive dollar amount with at most two decimals" });
      return z.NEVER;
    }
    return cents;
  });

export const voiceToolSchemas = {
  get_market_quote: z.object({}),
  propose_trade: z.object({
    outcome: z.enum(["yes", "no"]).describe("Which side to buy: yes or no."),
    amount_usd: amountUsd,
  }),
  approve_pending_trade: z.object({
    intent_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Id of the pending trade to approve. Omit it to approve the most recent pending voice trade."),
  }),
  get_desk_status: z.object({}),
} satisfies Record<VoiceToolName, z.ZodType>;

export type VoiceToolInput<Name extends VoiceToolName> = z.output<(typeof voiceToolSchemas)[Name]>;

export const voiceToolDescriptions = {
  get_market_quote:
    "Look up the prediction market currently matched to the latest news: yes and no odds in cents, the headline that triggered the match, why it matched, and the remaining daily budget. Always call this before discussing odds.",
  propose_trade:
    "Place a paper trade on the matched market through the desk guardrails. Only call after the user has explicitly confirmed the side and dollar amount. The result may be placed, waiting for approval, or refused.",
  approve_pending_trade:
    "Approve a trade that is waiting for approval. Only call after the user has explicitly said to approve it.",
  get_desk_status:
    "Report how much was spent and is left in today's budget, the trades waiting for approval, and whether the kill switch is on.",
} as const satisfies Record<VoiceToolName, string>;
