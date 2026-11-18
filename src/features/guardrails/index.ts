import { usdCents } from "@/shared";
import type { InstrumentSymbol, TradeIntent, UsdCents } from "@/shared";

export interface PolicyConfig {
  readonly dailyCap: UsdCents;
  readonly autoApproveMax: UsdCents;
  readonly perTradeMax: UsdCents;
  readonly marketAllowlist: ReadonlySet<InstrumentSymbol>;
  readonly senderAllowlist: ReadonlySet<string>;
  readonly killSwitch: boolean;
}

export function createPolicy(config: PolicyConfig):
  | { ok: true; value: PolicyConfig }
  | { ok: false; error: "invalid-caps" } {
  const { dailyCap, perTradeMax, autoApproveMax } = config;
  if (![dailyCap, perTradeMax, autoApproveMax].every(Number.isSafeInteger)
    || autoApproveMax < 0 || autoApproveMax > perTradeMax || perTradeMax > dailyCap) {
    return { ok: false, error: "invalid-caps" };
  }
  return {
    ok: true,
    value: Object.freeze({
      ...config,
      marketAllowlist: new Set(config.marketAllowlist),
      senderAllowlist: new Set(config.senderAllowlist),
    }),
  };
}

export interface PolicyState {
  readonly day: string;
  readonly spentToday: UsdCents;
  readonly reservedToday: UsdCents;
  readonly seenIntentIds: ReadonlySet<string>;
}

interface PolicyMarket {
  readonly instrumentSymbol: InstrumentSymbol;
  readonly marketState: string;
  readonly status: string;
}

export type RefusalCode = "kill-switch" | "unauthorized-sender" | "market-not-allowlisted"
  | "market-closed" | "zero-notional" | "over-per-trade-cap" | "over-daily-cap" | "duplicate-intent";

type Refusal = {
  readonly kind: "refuse";
  readonly intentId: string;
  readonly code: RefusalCode;
  readonly spokenReason: string;
};

class TradeDecision {
  readonly #trade: Pick<TradeIntent, "instrumentSymbol" | "outcome">;
  readonly intentId: string;
  readonly notional: UsdCents;
  readonly spokenReason: string;

  constructor(trade: Pick<TradeIntent, "intentId" | "notional" | "instrumentSymbol" | "outcome">, spokenReason: string) {
    this.#trade = { instrumentSymbol: trade.instrumentSymbol, outcome: trade.outcome };
    this.intentId = trade.intentId;
    this.notional = trade.notional;
    this.spokenReason = spokenReason;
  }

  get instrumentSymbol() { return this.#trade.instrumentSymbol; }
  get outcome() { return this.#trade.outcome; }
}

class Approval extends TradeDecision {
  readonly kind = "approve";

  constructor(trade: ConstructorParameters<typeof TradeDecision>[0]) {
    super(trade, `I approved the ${dollars(trade.notional)} trade.`);
    Object.freeze(this);
  }
}

class PendingApproval extends TradeDecision {
  readonly kind = "needs-approval";

  constructor(trade: TradeIntent) {
    super(trade, `The ${dollars(trade.notional)} trade needs your approval.`);
    Object.freeze(this);
  }
}

export type ApprovedTrade = Approval;
export type Decision = ApprovedTrade | PendingApproval | Refusal;

export function rollDay(state: PolicyState, now: Date): PolicyState {
  const day = now.toISOString().slice(0, 10);
  if (day === state.day) return state;
  return { ...state, day, spentToday: usdCents(0), reservedToday: usdCents(0) };
}

function dollars(cents: UsdCents): string {
  const amount = BigInt(cents);
  return amount % 100n === 0n
    ? `$${String(amount / 100n)}`
    : `$${String(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
}

function refusalReason(code: RefusalCode, notional: UsdCents, policy: PolicyConfig, remaining: UsdCents): string {
  switch (code) {
    case "kill-switch": return "Trading is paused.";
    case "unauthorized-sender": return "This account isn't authorized to approve or request trades.";
    case "duplicate-intent": return "I've already approved this trade.";
    case "market-not-allowlisted": return "This market isn't on the trading allowlist.";
    case "market-closed": return "This market isn't open for trading.";
    case "zero-notional": return "The trade amount must be greater than $0.";
    case "over-per-trade-cap": return `A ${dollars(notional)} trade exceeds the ${dollars(policy.perTradeMax)} limit per trade.`;
    case "over-daily-cap": return `A ${dollars(notional)} trade would exceed today's ${dollars(policy.dailyCap)} cap, with ${dollars(remaining)} left.`;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export function evaluate(intent: TradeIntent, market: PolicyMarket, policy: PolicyConfig, state: PolicyState, now: Date): Decision {
  const current = rollDay(state, now);
  const remaining = usdCents(Math.max(0, policy.dailyCap - current.spentToday - current.reservedToday));
  const { intentId, notional } = intent;
  const refuse = (code: RefusalCode): Refusal => ({
    kind: "refuse", intentId, code, spokenReason: refusalReason(code, notional, policy, remaining),
  });

  if (policy.killSwitch) return refuse("kill-switch");
  if (!policy.senderAllowlist.has(intent.senderId)) return refuse("unauthorized-sender");
  if (current.seenIntentIds.has(intentId)) return refuse("duplicate-intent");
  if (!policy.marketAllowlist.has(intent.instrumentSymbol)) return refuse("market-not-allowlisted");
  if (market.instrumentSymbol !== intent.instrumentSymbol || market.marketState !== "open") return refuse("market-closed");
  if (notional === 0) return refuse("zero-notional");
  if (notional > policy.perTradeMax) return refuse("over-per-trade-cap");
  if (notional > remaining) return refuse("over-daily-cap");
  if (notional > policy.autoApproveMax) return new PendingApproval(intent);
  return new Approval(intent);
}

export function confirm(pending: PendingApproval, approverId: string, policy: PolicyConfig): ApprovedTrade | Refusal {
  const code = policy.killSwitch ? "kill-switch" : "unauthorized-sender";
  if (policy.killSwitch || !policy.senderAllowlist.has(approverId)) {
    return {
      kind: "refuse",
      intentId: pending.intentId,
      code,
      spokenReason: refusalReason(code, pending.notional, policy, usdCents(0)),
    };
  }
  return new Approval(pending);
}

export function applyApproved(state: PolicyState, approved: ApprovedTrade): PolicyState {
  if (state.seenIntentIds.has(approved.intentId)) return state;
  return {
    ...state,
    spentToday: usdCents(state.spentToday + approved.notional),
    seenIntentIds: new Set([...state.seenIntentIds, approved.intentId]),
  };
}
