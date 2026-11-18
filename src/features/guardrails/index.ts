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

class Policy {
  readonly #config: PolicyConfig;

  private constructor(config: PolicyConfig) {
    this.#config = {
      ...config,
      marketAllowlist: new Set(config.marketAllowlist),
      senderAllowlist: new Set(config.senderAllowlist),
    };
    Object.freeze(this);
  }

  static create(config: PolicyConfig): { ok: true; value: Policy } | { ok: false; error: "invalid-caps" } {
    const { dailyCap, perTradeMax, autoApproveMax } = config;
    if (![dailyCap, perTradeMax, autoApproveMax].every(Number.isSafeInteger)
      || autoApproveMax < 0 || autoApproveMax > perTradeMax || perTradeMax > dailyCap) {
      return { ok: false, error: "invalid-caps" };
    }
    return { ok: true, value: new Policy(config) };
  }

  get dailyCap() { return this.#config.dailyCap; }
  get perTradeMax() { return this.#config.perTradeMax; }
  get autoApproveMax() { return this.#config.autoApproveMax; }
  get killSwitch() { return this.#config.killSwitch; }
  get marketAllowlist(): ReadonlySet<InstrumentSymbol> { return new Set(this.#config.marketAllowlist); }
  get senderAllowlist(): ReadonlySet<string> { return new Set(this.#config.senderAllowlist); }

  allowsMarket(symbol: InstrumentSymbol): boolean { return this.#config.marketAllowlist.has(symbol); }
  allowsSender(senderId: string): boolean { return this.#config.senderAllowlist.has(senderId); }

  withKillSwitch(killSwitch: boolean): Policy {
    return this.killSwitch === killSwitch ? this : new Policy({ ...this.#config, killSwitch });
  }
}

export type { Policy };
export function createPolicy(config: PolicyConfig) {
  return Policy.create(config);
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
  readonly eventStatus: string;
  readonly limitPrice: UsdCents;
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

function refusalReason(code: RefusalCode, notional: UsdCents, policy: Policy, remaining: UsdCents): string {
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

function findRefusal(
  trade: Pick<TradeIntent, "intentId" | "instrumentSymbol" | "notional">,
  actorId: string,
  policy: Policy,
  state: PolicyState,
  remaining: UsdCents,
  market: PolicyMarket | undefined,
): RefusalCode | undefined {
  if (policy.killSwitch) return "kill-switch";
  if (!policy.allowsSender(actorId)) return "unauthorized-sender";
  if (state.seenIntentIds.has(trade.intentId)) return "duplicate-intent";
  if (!policy.allowsMarket(trade.instrumentSymbol)) return "market-not-allowlisted";
  if (!market || market.instrumentSymbol !== trade.instrumentSymbol || market.eventStatus !== "active"
    || market.status !== "active" || market.marketState !== "open"
    || !Number.isInteger(market.limitPrice) || market.limitPrice <= 0 || market.limitPrice > 100) return "market-closed";
  if (trade.notional === 0) return "zero-notional";
  if (trade.notional > policy.perTradeMax) return "over-per-trade-cap";
  if (trade.notional > remaining) return "over-daily-cap";
  return undefined;
}

function remainingToday(policy: Policy, state: PolicyState): UsdCents {
  return usdCents(Math.max(0, policy.dailyCap - state.spentToday - state.reservedToday));
}

function refusal(trade: Pick<TradeIntent, "intentId" | "notional">, code: RefusalCode, policy: Policy, remaining: UsdCents): Refusal {
  return { kind: "refuse", intentId: trade.intentId, code, spokenReason: refusalReason(code, trade.notional, policy, remaining) };
}

export function evaluate(intent: TradeIntent, market: PolicyMarket | undefined, policy: Policy, state: PolicyState, now: Date): Decision {
  const current = rollDay(state, now);
  const remaining = remainingToday(policy, current);
  const code = findRefusal(intent, intent.senderId, policy, current, remaining, market);
  if (code) return refusal(intent, code, policy, remaining);
  return intent.notional > policy.autoApproveMax ? new PendingApproval(intent) : new Approval(intent);
}

export function confirm(pending: PendingApproval, approverId: string, market: PolicyMarket | undefined, policy: Policy, state: PolicyState, now: Date): ApprovedTrade | Refusal {
  const current = rollDay(state, now);
  const remaining = remainingToday(policy, current);
  const code = findRefusal(pending, approverId, policy, current, remaining, market);
  return code ? refusal(pending, code, policy, remaining) : new Approval(pending);
}

export function applyApproved(state: PolicyState, approved: ApprovedTrade): PolicyState {
  if (state.seenIntentIds.has(approved.intentId)) return state;
  return {
    ...state,
    spentToday: usdCents(state.spentToday + approved.notional),
    seenIntentIds: new Set([...state.seenIntentIds, approved.intentId]),
  };
}
