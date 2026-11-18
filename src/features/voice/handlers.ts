import type { Desk } from "@/features/desk";
import type { DecisionKind, DecisionLogEntry, DeskSnapshot, MarketView, Outcome, PendingView } from "@/shared";
import type { z } from "zod";
import { centsToUsd } from "./amount";
import { voiceToolSchemas } from "./tools";
import type { VoiceToolName } from "./tools";

export interface VoiceDeps {
  readonly desk: Desk;
  readonly operatorId: string;
}

export interface TradeOutcome {
  readonly intentId: string;
  readonly side: Outcome;
  readonly amountUsd: number;
  readonly ticketId?: string;
  readonly explorerUrl?: string;
  readonly code?: string;
}

export type TradeStatus = "placed" | "needs-approval" | "refused" | "failed";

export interface PendingSummary {
  readonly intentId: string;
  readonly side: Outcome;
  readonly amountUsd: number;
}

export type VoiceToolResult =
  | {
      readonly status: "quote";
      readonly say: string;
      readonly market: {
        readonly title: string;
        readonly contract: string;
        readonly symbol: string;
        readonly yesCents: number | null;
        readonly noCents: number | null;
        readonly state: string;
      };
      readonly news: { readonly headline: string; readonly matchReasons: readonly string[] };
      readonly budgetRemainingUsd: number;
    }
  | { readonly status: "no-match"; readonly say: string }
  | ({ readonly status: TradeStatus; readonly say: string } & TradeOutcome)
  | { readonly status: "nothing-pending" | "unknown-intent"; readonly say: string }
  | {
      readonly status: "desk-status";
      readonly say: string;
      readonly spentUsd: number;
      readonly remainingUsd: number;
      readonly dailyCapUsd: number;
      readonly killSwitch: boolean;
      readonly pending: readonly PendingSummary[];
    }
  | { readonly status: "invalid-request"; readonly say: string; readonly issues: readonly string[] };

export type VoiceStatus = VoiceToolResult["status"];

const TRADE_STATUS: Record<DecisionKind, TradeStatus> = {
  approve: "placed",
  "needs-approval": "needs-approval",
  refuse: "refused",
  "execution-failed": "failed",
};

function dollars(cents: number): string {
  const amount = centsToUsd(cents);
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return amount === 1 ? "1 dollar" : `${text} dollars`;
}

function odds(cents: number | null): string {
  return cents === null ? "unavailable" : `${String(cents)} cents`;
}

function tradeResult(entry: DecisionLogEntry): VoiceToolResult {
  return {
    status: TRADE_STATUS[entry.kind],
    say: entry.spokenReason,
    intentId: entry.intentId,
    side: entry.outcome,
    amountUsd: centsToUsd(entry.notionalCents),
    ...(entry.ticket ? { ticketId: entry.ticket.ticketId } : {}),
    ...(entry.explorerUrl ? { explorerUrl: entry.explorerUrl } : {}),
    ...(entry.code ? { code: entry.code } : {}),
  };
}

function matchedMarket(snapshot: DeskSnapshot): MarketView | undefined {
  return snapshot.match.kind === "matched" ? snapshot.match.market : undefined;
}

function operatorPending(snapshot: DeskSnapshot, operatorId: string): readonly PendingView[] {
  return snapshot.pending
    .filter((item) => item.senderId === operatorId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function getMarketQuote({ desk }: VoiceDeps): Promise<VoiceToolResult> {
  const snapshot = await desk.getSnapshot();
  const { match, news } = snapshot;
  if (match.kind !== "matched" || !news) {
    return { status: "no-match", say: "No market is matched to any news right now, so I have no odds to read. Send me a headline first." };
  }
  const { market } = match;
  const budget = dollars(snapshot.policy.remainingCents);
  return {
    status: "quote",
    say:
      `The matched market is ${market.eventTitle}, contract ${market.contractLabel}. ` +
      `Yes is ${odds(market.yesCents)} and no is ${odds(market.noCents)}. ` +
      `It matched this news: ${news.text}. You have ${budget} left in today's budget.`,
    market: {
      title: market.eventTitle,
      contract: market.contractLabel,
      symbol: market.instrumentSymbol,
      yesCents: market.yesCents,
      noCents: market.noCents,
      state: market.marketState,
    },
    news: { headline: news.text, matchReasons: match.reasons },
    budgetRemainingUsd: centsToUsd(snapshot.policy.remainingCents),
  };
}

async function proposeTrade(
  { desk, operatorId }: VoiceDeps,
  input: z.output<(typeof voiceToolSchemas)["propose_trade"]>,
): Promise<VoiceToolResult> {
  const market = matchedMarket(await desk.getSnapshot());
  if (!market) return { status: "no-match", say: "No market is matched to any news right now, so I can't place a trade." };
  const entry = await desk.proposeTrade({
    instrumentSymbol: market.instrumentSymbol,
    outcome: input.outcome,
    notionalCents: input.amount_usd,
    source: "voice",
    senderId: operatorId,
  });
  return tradeResult(entry);
}

async function approvePendingTrade(
  { desk, operatorId }: VoiceDeps,
  input: z.output<(typeof voiceToolSchemas)["approve_pending_trade"]>,
): Promise<VoiceToolResult> {
  const waiting = operatorPending(await desk.getSnapshot(), operatorId);
  const intentId = input.intent_id ?? waiting.at(-1)?.intentId;
  if (intentId === undefined) return { status: "nothing-pending", say: "There is no trade waiting for approval." };
  const result = await desk.confirmPending(intentId, operatorId);
  if (!result.ok) return { status: "unknown-intent", say: "I can't find that pending trade. It may already be approved or gone." };
  return tradeResult(result.entry);
}

async function getDeskStatus({ desk, operatorId }: VoiceDeps): Promise<VoiceToolResult> {
  const snapshot = await desk.getSnapshot();
  const { policy } = snapshot;
  const pending = operatorPending(snapshot, operatorId).map(
    (item): PendingSummary => ({ intentId: item.intentId, side: item.outcome, amountUsd: centsToUsd(item.notionalCents) }),
  );
  const pendingSpeech =
    pending.length === 0
      ? "Nothing is waiting for approval."
      : `${String(pending.length)} trade${pending.length === 1 ? " is" : "s are"} waiting for approval.`;
  const killSpeech = policy.killSwitch ? "The kill switch is on, so all trading is stopped." : "The kill switch is off.";
  return {
    status: "desk-status",
    say: `You have spent ${dollars(policy.spentCents)} today and have ${dollars(policy.remainingCents)} left. ${pendingSpeech} ${killSpeech}`,
    spentUsd: centsToUsd(policy.spentCents),
    remainingUsd: centsToUsd(policy.remainingCents),
    dailyCapUsd: centsToUsd(policy.dailyCapCents),
    killSwitch: policy.killSwitch,
    pending,
  };
}

type VoiceRunner = (deps: VoiceDeps, rawParameters: unknown) => Promise<VoiceToolResult>;

function runner<Schema extends z.ZodType>(
  schema: Schema,
  handle: (deps: VoiceDeps, input: z.output<Schema>) => Promise<VoiceToolResult>,
): VoiceRunner {
  return async (deps, rawParameters) => {
    const parsed = schema.safeParse(rawParameters);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`);
      return { status: "invalid-request", say: `I couldn't use that request: ${issues.join("; ")}.`, issues };
    }
    return handle(deps, parsed.data);
  };
}

const runners = {
  get_market_quote: runner(voiceToolSchemas.get_market_quote, getMarketQuote),
  propose_trade: runner(voiceToolSchemas.propose_trade, proposeTrade),
  approve_pending_trade: runner(voiceToolSchemas.approve_pending_trade, approvePendingTrade),
  get_desk_status: runner(voiceToolSchemas.get_desk_status, getDeskStatus),
} satisfies Record<VoiceToolName, VoiceRunner>;

export function runVoiceTool(deps: VoiceDeps, name: VoiceToolName, rawParameters: unknown): Promise<VoiceToolResult> {
  return runners[name](deps, rawParameters);
}
