import { usdCents } from "@/shared";
import type { InstrumentSymbol, TradeIntent, UsdCents } from "@/shared";

export interface PolicyConfig {
  readonly dailyCap: UsdCents;
  readonly autoApproveMax: UsdCents;
  readonly perTradeMax: UsdCents;
  readonly marketAllowlist: ReadonlySet<InstrumentSymbol>;
  readonly marketCategories: ReadonlySet<string>;
  readonly senderAllowlist: ReadonlySet<string>;
  readonly killSwitch: boolean;
}

export const MAX_PRICE_SLIPPAGE_CENTS = 2;

export const DEFAULT_MARKET_CATEGORIES: readonly string[] = ["Economics", "Politics", "Tech", "Culture", "Crypto", "Commodities"];

function categoryKey(category: string): string {
  return category.trim().toLowerCase();
}

class Policy {
  readonly #config: PolicyConfig;

  private constructor(config: PolicyConfig) {
    this.#config = {
      ...config,
      marketAllowlist: new Set(config.marketAllowlist),
      marketCategories: new Set(config.marketCategories),
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
  get marketCategories(): ReadonlySet<string> { return new Set(this.#config.marketCategories); }
  get senderAllowlist(): ReadonlySet<string> { return new Set(this.#config.senderAllowlist); }

  allowsMarket(symbol: InstrumentSymbol, category: string): boolean {
    return this.#config.marketAllowlist.has(symbol)
      || [...this.#config.marketCategories].some((allowed) => categoryKey(allowed) === categoryKey(category));
  }
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
  readonly category: string;
  readonly limitPrice: UsdCents;
}

export type RefusalCode = "kill-switch" | "unauthorized-sender" | "market-category-not-allowed"
  | "market-closed" | "price-moved" | "zero-notional" | "over-per-trade-cap" | "over-daily-cap" | "duplicate-intent";

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

interface RefusalFacts {
  readonly notional: UsdCents;
  readonly remaining: UsdCents;
  readonly category: string | undefined;
  readonly seenPriceCents: number | undefined;
  readonly livePriceCents: number | undefined;
}

function refusalReason(code: RefusalCode, policy: Policy, facts: RefusalFacts): string {
  const { notional, remaining, category, seenPriceCents, livePriceCents } = facts;
  switch (code) {
    case "kill-switch": return "Trading is paused.";
    case "unauthorized-sender": return "This account isn't authorized to approve or request trades.";
    case "duplicate-intent": return "I've already approved this trade.";
    case "market-category-not-allowed": return `${category?.trim() || "These"} markets are outside the desk's news-trading policy.`;
    case "market-closed": return "This market isn't open for trading.";
    case "price-moved": return `The price moved from ${String(seenPriceCents)}¢ to ${String(livePriceCents)}¢ since you saw it, so I did not place the trade.`;
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
  trade: Pick<TradeIntent, "intentId" | "instrumentSymbol" | "notional" | "seenPriceCents">,
  actorId: string,
  policy: Policy,
  state: PolicyState,
  remaining: UsdCents,
  market: PolicyMarket | undefined,
): RefusalCode | undefined {
  if (policy.killSwitch) return "kill-switch";
  if (!policy.allowsSender(actorId)) return "unauthorized-sender";
  if (state.seenIntentIds.has(trade.intentId)) return "duplicate-intent";
  if (!market || market.instrumentSymbol !== trade.instrumentSymbol || market.eventStatus !== "active"
    || market.status !== "active" || market.marketState !== "open"
    || !Number.isInteger(market.limitPrice) || market.limitPrice <= 0 || market.limitPrice > 100) return "market-closed";
  if (!policy.allowsMarket(trade.instrumentSymbol, market.category)) return "market-category-not-allowed";
  if (trade.seenPriceCents !== undefined && market.limitPrice - trade.seenPriceCents > MAX_PRICE_SLIPPAGE_CENTS) return "price-moved";
  if (trade.notional === 0) return "zero-notional";
  if (trade.notional > policy.perTradeMax) return "over-per-trade-cap";
  if (trade.notional > remaining) return "over-daily-cap";
  return undefined;
}

function remainingToday(policy: Policy, state: PolicyState): UsdCents {
  return usdCents(Math.max(0, policy.dailyCap - state.spentToday - state.reservedToday));
}

function refusal(
  trade: Pick<TradeIntent, "intentId" | "notional" | "seenPriceCents">,
  code: RefusalCode,
  policy: Policy,
  remaining: UsdCents,
  market: PolicyMarket | undefined,
): Refusal {
  return { kind: "refuse", intentId: trade.intentId, code, spokenReason: refusalReason(code, policy, {
      notional: trade.notional,
      remaining,
      category: market?.category,
      seenPriceCents: trade.seenPriceCents,
      livePriceCents: market?.limitPrice,
    }),
  };
}

export function marketPolicyRefusal(policy: Policy, symbol: InstrumentSymbol, category: string): string | undefined {
  return policy.allowsMarket(symbol, category) ? undefined : refusalReason("market-category-not-allowed", policy, {
    notional: usdCents(0),
    remaining: usdCents(0),
    category,
    seenPriceCents: undefined,
    livePriceCents: undefined,
  });
}

export function evaluate(intent: TradeIntent, market: PolicyMarket | undefined, policy: Policy, state: PolicyState, now: Date): Decision {
  const current = rollDay(state, now);
  const remaining = remainingToday(policy, current);
  const code = findRefusal(intent, intent.senderId, policy, current, remaining, market);
  if (code) return refusal(intent, code, policy, remaining, market);
  return intent.notional > policy.autoApproveMax ? new PendingApproval(intent) : new Approval(intent);
}

export function restorePendingApproval(intent: TradeIntent): PendingApproval {
  return new PendingApproval(intent);
}

export function confirm(pending: PendingApproval, approverId: string, market: PolicyMarket | undefined, policy: Policy, state: PolicyState, now: Date): ApprovedTrade | Refusal {
  const current = rollDay(state, now);
  const remaining = remainingToday(policy, current);
  const code = findRefusal(pending, approverId, policy, current, remaining, market);
  return code ? refusal(pending, code, policy, remaining, market) : new Approval(pending);
}

export function applyApproved(state: PolicyState, approved: Pick<ApprovedTrade, "intentId" | "notional">): PolicyState {
  if (state.seenIntentIds.has(approved.intentId)) return state;
  return {
    ...state,
    spentToday: usdCents(state.spentToday + approved.notional),
    seenIntentIds: new Set([...state.seenIntentIds, approved.intentId]),
  };
}

export type ResearchRefusalCode = "kill-switch" | "zero-notional" | "over-per-trade-cap" | "over-auto-approve-max" | "over-daily-cap" | "duplicate-intent";

export interface ResearchSpend {
  readonly spendId: string;
  readonly notional: UsdCents;
}

export type ResearchRefusal = {
  readonly kind: "refuse";
  readonly spendId: string;
  readonly code: ResearchRefusalCode;
  readonly spokenReason: string;
};

class ApprovedResearch {
  readonly kind = "approve";
  readonly intentId: string;
  readonly notional: UsdCents;
  readonly spokenReason: string;

  constructor(spend: ResearchSpend) {
    this.intentId = spend.spendId;
    this.notional = spend.notional;
    this.spokenReason = `I approved the ${dollars(spend.notional)} research purchase.`;
    Object.freeze(this);
  }
}

export type { ApprovedResearch };
export type ResearchDecision = ApprovedResearch | ResearchRefusal;

function researchRefusalReason(code: ResearchRefusalCode, policy: Policy, notional: UsdCents, remaining: UsdCents): string {
  switch (code) {
    case "kill-switch": return "Trading is paused, so I did not buy research.";
    case "duplicate-intent": return "I've already approved this research purchase.";
    case "zero-notional": return "The research price must be greater than $0.";
    case "over-per-trade-cap": return `A ${dollars(notional)} research purchase exceeds the ${dollars(policy.perTradeMax)} limit per trade.`;
    case "over-auto-approve-max": return `A ${dollars(notional)} research purchase is above the ${dollars(policy.autoApproveMax)} I can approve on my own.`;
    case "over-daily-cap": return `A ${dollars(notional)} research purchase would exceed today's ${dollars(policy.dailyCap)} budget, with ${dollars(remaining)} left.`;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

function findResearchRefusal(spend: ResearchSpend, policy: Policy, state: PolicyState, remaining: UsdCents): ResearchRefusalCode | undefined {
  if (policy.killSwitch) return "kill-switch";
  if (state.seenIntentIds.has(spend.spendId)) return "duplicate-intent";
  if (spend.notional === 0) return "zero-notional";
  if (spend.notional > policy.perTradeMax) return "over-per-trade-cap";
  if (spend.notional > policy.autoApproveMax) return "over-auto-approve-max";
  if (spend.notional > remaining) return "over-daily-cap";
  return undefined;
}

export function evaluateResearch(spend: ResearchSpend, policy: Policy, state: PolicyState, now: Date): ResearchDecision {
  const current = rollDay(state, now);
  const remaining = remainingToday(policy, current);
  const code = findResearchRefusal(spend, policy, current, remaining);
  if (!code) return new ApprovedResearch(spend);
  return { kind: "refuse", spendId: spend.spendId, code, spokenReason: researchRefusalReason(code, policy, spend.notional, remaining) };
}

export function remainingBudget(policy: Policy, state: PolicyState, now: Date): UsdCents {
  return remainingToday(policy, rollDay(state, now));
}

export interface SpendRecord {
  readonly operationId: string;
  readonly status: "reserved" | "settled" | "failed";
  readonly notionalCents: number;
  readonly resolvedAt?: string | undefined;
}

export function policyStateFromSpends(spends: readonly SpendRecord[], now: Date): PolicyState {
  const day = now.toISOString().slice(0, 10);
  const total = (matches: (spend: SpendRecord) => boolean) => spends.filter(matches).reduce((sum, spend) => sum + spend.notionalCents, 0);
  return {
    day,
    spentToday: usdCents(total((spend) => spend.status === "settled" && spend.resolvedAt?.slice(0, 10) === day)),
    reservedToday: usdCents(total((spend) => spend.status === "reserved")),
    seenIntentIds: new Set(spends.map((spend) => spend.operationId)),
  };
}
