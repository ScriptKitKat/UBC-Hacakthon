import type { ApprovedTrade } from "@/features/guardrails";
import type { ContractLimits } from "@/features/markets";
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
}

export interface PaperOrderTicket {
  readonly ticketId: string;
  readonly payload: GeminiOrderPayload;
  readonly mode: TRADING_MODE;
  readonly createdAt: Date;
}

export type OrderBuildError = { readonly code: "invalid-limit-price" | "quantity-below-minimum" };

export type ExecutionError = OrderBuildError | LedgerError;

type Result<Value, Error> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Error };

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
  readonly limits?: ContractLimits | null;
}

const HUNDREDTHS_PER_UNIT = 100n;

function validLimitPrice(price: UsdCents): boolean {
  return Number.isInteger(price) && price > 0 && price <= 100;
}

function formatHundredths(amount: bigint): string {
  const fraction = String(amount % HUNDREDTHS_PER_UNIT).padStart(2, "0");
  return `${String(amount / HUNDREDTHS_PER_UNIT)}.${fraction}`;
}

export function buildGeminiOrderPayload(
  approved: ApprovedTrade,
  limitPrice: UsdCents,
  options: { readonly timeInForce?: GeminiOrderPayload["timeInForce"]; readonly limits?: ContractLimits | null } = {},
): Result<GeminiOrderPayload, OrderBuildError> {
  if (!validLimitPrice(limitPrice)) return { ok: false, error: { code: "invalid-limit-price" } };
  const { timeInForce = "good-til-cancel", limits = null } = options;
  const priceCents = BigInt(limitPrice);
  if (limits && (limits.priceIncrementCents <= 0n || priceCents < limits.priceMinimumCents
    || priceCents % limits.priceIncrementCents !== 0n)) {
    return { ok: false, error: { code: "invalid-limit-price" } };
  }
  const increment = limits?.quantityIncrementHundredths ?? 1n;
  if (increment <= 0n) return { ok: false, error: { code: "quantity-below-minimum" } };
  const affordable = BigInt(approved.notional) * HUNDREDTHS_PER_UNIT / priceCents;
  const quantity = affordable - (affordable % increment);
  if (quantity === 0n || quantity < (limits?.quantityMinimumHundredths ?? 1n)) {
    return { ok: false, error: { code: "quantity-below-minimum" } };
  }
  return {
    ok: true,
    value: {
      symbol: approved.instrumentSymbol,
      orderType: "limit",
      side: "buy",
      quantity: formatHundredths(quantity),
      price: formatHundredths(priceCents),
      outcome: approved.outcome,
      timeInForce,
    },
  };
}

export async function executeApproved(approved: ApprovedTrade, deps: ExecutionDeps): Promise<TradeRecord> {
  const { intentId, instrumentSymbol, outcome, notional, spokenReason } = approved;
  const trade = { intentId, instrumentSymbol, outcome, notional, spokenReason };
  const { limitPrice } = deps;
  const order = buildGeminiOrderPayload(approved, limitPrice, { limits: deps.limits ?? null });
  if (!order.ok) return { ...trade, kind: "execution-failed", error: order.error };

  const memo = [intentId, instrumentSymbol, outcome, String(notional)].join("|");
  const debit = await deps.ledger.debit(intentId, notional, memo);
  if (!debit.ok) return { ...trade, kind: "execution-failed", error: debit.error };

  return {
    ...trade,
    kind: "paper-order",
    debit: debit.value,
    ticket: {
      ticketId: deps.idGen(),
      payload: order.value,
      mode: "paper",
      createdAt: deps.now(),
    },
  };
}
