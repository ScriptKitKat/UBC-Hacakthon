import { AMOUNT_CHOICES_CENTS } from "./protocol";
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
  readonly amountCents: number;
  readonly status: TradeStatus;
}

export type CardAction =
  | { readonly type: "quote-received"; readonly quote: WireQuote }
  | { readonly type: "amount-selected"; readonly amountCents: number }
  | { readonly type: "buy-started" }
  | { readonly type: "buy-settled"; readonly entry: WireEntry }
  | { readonly type: "buy-failed"; readonly message: string }
  | { readonly type: "approve-started" }
  | { readonly type: "approve-settled"; readonly entry: WireEntry }
  | { readonly type: "approve-failed"; readonly message: string };

const [DEFAULT_AMOUNT_CENTS] = AMOUNT_CHOICES_CENTS;

export function initialCardState(match: WireMatched): CardState {
  return { match, market: match.market, history: [], amountCents: DEFAULT_AMOUNT_CENTS, status: { phase: "idle" } };
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
  return state.market.tradeable && !isBusy(state) && state.status.phase !== "needs-approval";
}

export function cardReducer(state: CardState, action: CardAction): CardState {
  const { status } = state;
  switch (action.type) {
    case "quote-received":
      return { ...state, market: action.quote.market, history: action.quote.history };
    case "amount-selected":
      return isBusy(state) ? state : { ...state, amountCents: action.amountCents };
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
