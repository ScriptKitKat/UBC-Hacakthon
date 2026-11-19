import { parseDollarsToCents, payoutFor } from "@/shared";
import { tradeCapCents } from "./trade-budget";
import type { TradeBudget } from "./trade-budget";
import type { WireEntry, WireMarket, WireMatched, WireQuote } from "./wire";

export type TradeStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "buying" }
  | { readonly phase: "filled"; readonly entry: WireEntry }
  | { readonly phase: "needs-approval"; readonly entry: WireEntry; readonly approvalError: string | null }
  | { readonly phase: "approving"; readonly entry: WireEntry }
  | { readonly phase: "refused"; readonly entry: WireEntry }
  | { readonly phase: "error"; readonly message: string };

export interface CardState {
  readonly match: WireMatched;
  readonly market: WireMarket;
  readonly history: WireQuote["history"];
  readonly contracts: readonly WireMarket[];
  readonly outcome: "yes" | "no";
  readonly amountText: string;
  readonly budget: TradeBudget | undefined;
  readonly status: TradeStatus;
}

export type CardAction =
  | { readonly type: "quote-received"; readonly quote: WireQuote }
  | { readonly type: "budget-received"; readonly budget: TradeBudget | undefined }
  | { readonly type: "amount-edited"; readonly amountText: string }
  | { readonly type: "contract-selected"; readonly symbol: string }
  | { readonly type: "outcome-selected"; readonly outcome: "yes" | "no" }
  | { readonly type: "buy-started" }
  | { readonly type: "buy-settled"; readonly entry: WireEntry }
  | { readonly type: "buy-failed"; readonly message: string }
  | { readonly type: "approve-started" }
  | { readonly type: "approve-settled"; readonly entry: WireEntry }
  | { readonly type: "approve-failed"; readonly message: string };

export function initialCardState(match: WireMatched, budget?: TradeBudget): CardState {
  return { match, market: match.market, contracts: match.contracts ?? [match.market], outcome: "yes", history: [], amountText: "1.00", budget, status: { phase: "idle" } };
}

export function statusFromEntry(entry: WireEntry): TradeStatus {
  switch (entry.kind) {
    case "approve":
      return { phase: "filled", entry };
    case "needs-approval":
      return { phase: "needs-approval", entry, approvalError: null };
    case "refuse":
    case "execution-failed":
      return { phase: "refused", entry };
    default: {
      const exhaustive: never = entry.kind;
      return exhaustive;
    }
  }
}

export function isBusy(state: CardState): boolean {
  return state.status.phase === "buying" || state.status.phase === "approving";
}

export function canBuy(state: CardState): boolean {
  const price = state.outcome === "yes" ? state.market.yesCents : state.market.noCents;
  const amountCents = parseDollarsToCents(state.amountText);
  return state.market.tradeable && amountCents !== undefined && amountCents <= tradeCapCents(state.budget)
    && payoutFor(price, amountCents, state.market.quantityLimits).kind === "quote" && !isBusy(state) && state.status.phase !== "needs-approval";
}

export function cardReducer(state: CardState, action: CardAction): CardState {
  const { status } = state;
  switch (action.type) {
    case "budget-received":
      return { ...state, budget: action.budget };
    case "quote-received":
      return action.quote.market.instrumentSymbol === state.market.instrumentSymbol
        ? { ...state, market: action.quote.market, contracts: action.quote.contracts ?? state.contracts, history: action.quote.history }
        : state;
    case "contract-selected": {
      if (isBusy(state) || status.phase === "needs-approval") return state;
      const market = state.contracts.find((contract) => contract.instrumentSymbol === action.symbol);
      return market ? { ...state, market, history: [], status: { phase: "idle" } } : state;
    }
    case "outcome-selected":
      return isBusy(state) || status.phase === "needs-approval" ? state : { ...state, outcome: action.outcome, status: { phase: "idle" } };
    case "amount-edited":
      return isBusy(state) || status.phase === "needs-approval" ? state : { ...state, amountText: action.amountText, status: { phase: "idle" } };
    case "buy-started":
      return canBuy(state) ? { ...state, status: { phase: "buying" } } : state;
    case "buy-settled":
      return status.phase === "buying" ? { ...state, status: statusFromEntry(action.entry) } : state;
    case "buy-failed":
      return status.phase === "buying" ? { ...state, status: { phase: "error", message: action.message } } : state;
    case "approve-started":
      return status.phase === "needs-approval" ? { ...state, status: { phase: "approving", entry: status.entry } } : state;
    case "approve-settled":
      return status.phase === "approving" ? { ...state, status: statusFromEntry(action.entry) } : state;
    case "approve-failed":
      return status.phase === "approving"
        ? { ...state, status: { phase: "needs-approval", entry: status.entry, approvalError: action.message } }
        : state;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
