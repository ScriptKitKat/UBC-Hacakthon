import type { ApprovedTrade } from "@/features/guardrails";
import type { DebitReceipt, LedgerError, UsdcLedger } from "@/features/ledger";
import type { InstrumentSymbol, Outcome, UsdCents } from "@/shared";

export type TRADING_MODE = "paper";

export interface GeminiOrderPayload {
  readonly symbol: InstrumentSymbol;
  readonly orderType: "limit";
  readonly side: "buy";
  readonly quantity: string;
  readonly price: string;
  readonly outcome: Outcome;
  readonly timeInForce: "good-til-cancel" | "immediate-or-cancel" | "fill-or-kill";
  readonly clientOrderId: string;
}

export interface PaperOrderTicket {
  readonly ticketId: string;
  readonly payload: GeminiOrderPayload;
  readonly mode: TRADING_MODE;
  readonly createdAt: Date;
}

export type ExecutionError = { readonly code: "invalid-limit-price" } | LedgerError;

interface TradeRecordDetails {
  readonly intentId: string;
  readonly instrumentSymbol: InstrumentSymbol;
  readonly outcome: Outcome;
  readonly notional: UsdCents;
  readonly spokenReason: string;
}

export type TradeRecord = TradeRecordDetails & (
  | { readonly kind: "paper-order"; readonly ticket: PaperOrderTicket; readonly debit: DebitReceipt }
  | { readonly kind: "execution-failed"; readonly error: ExecutionError }
);

interface ExecutionDeps {
  readonly ledger: Pick<UsdcLedger, "debit">;
  readonly now: () => Date;
  readonly idGen: () => string;
  readonly limitPrice: UsdCents;
}

function validLimitPrice(price: UsdCents): boolean {
  return Number.isInteger(price) && price > 0 && price <= 100;
}

function decimalHundredths(amount: bigint): string {
  return `${String(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
}

export function buildGeminiOrderPayload(
  approved: ApprovedTrade,
  limitPrice: UsdCents,
  timeInForce: GeminiOrderPayload["timeInForce"] = "good-til-cancel",
): GeminiOrderPayload {
  if (!validLimitPrice(limitPrice)) throw new RangeError("Limit price must be between 1 and 100 cents");
  const price = BigInt(limitPrice);
  const quantityHundredths = BigInt(approved.notional) * 100n / price;
  return {
    symbol: approved.instrumentSymbol,
    orderType: "limit",
    side: "buy",
    quantity: decimalHundredths(quantityHundredths),
    price: decimalHundredths(price),
    outcome: approved.outcome,
    timeInForce,
    clientOrderId: approved.intentId,
  };
}

export async function executeApproved(approved: ApprovedTrade, deps: ExecutionDeps): Promise<TradeRecord> {
  const { intentId, instrumentSymbol, outcome, notional, spokenReason } = approved;
  const trade = { intentId, instrumentSymbol, outcome, notional, spokenReason };
  const { limitPrice } = deps;
  if (!validLimitPrice(limitPrice)) return { ...trade, kind: "execution-failed", error: { code: "invalid-limit-price" } };

  const memo = [intentId, instrumentSymbol, outcome, String(notional)].join("|");
  const debit = await deps.ledger.debit(intentId, notional, memo);
  if (!debit.ok) return { ...trade, kind: "execution-failed", error: debit.error };

  return {
    ...trade,
    kind: "paper-order",
    debit: debit.value,
    ticket: {
      ticketId: deps.idGen(),
      payload: buildGeminiOrderPayload(approved, limitPrice),
      mode: "paper",
      createdAt: deps.now(),
    },
  };
}
