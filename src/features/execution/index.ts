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

const DECIMAL_SCALE = 6;
const SCALE = 10n ** BigInt(DECIMAL_SCALE);
const DEFAULT_INCREMENT = 10_000n;
const MIN_DISPLAY_DECIMALS = 2;

function validLimitPrice(price: UsdCents): boolean {
  return Number.isInteger(price) && price > 0 && price <= 100;
}

function parseScaled(decimal: string): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMAL_SCALE, "0").slice(0, DECIMAL_SCALE));
}

function formatScaled(amount: bigint, decimals: number): string {
  const fraction = String(amount % SCALE).padStart(DECIMAL_SCALE, "0").slice(0, decimals);
  return `${String(amount / SCALE)}.${fraction}`;
}

function decimalPlaces(decimal: string): number {
  return Math.max(MIN_DISPLAY_DECIMALS, decimal.split(".")[1]?.replace(/0+$/, "").length ?? 0);
}

export function buildGeminiOrderPayload(
  approved: ApprovedTrade,
  limitPrice: UsdCents,
  options: { readonly timeInForce?: GeminiOrderPayload["timeInForce"]; readonly limits?: ContractLimits | null } = {},
): Result<GeminiOrderPayload, OrderBuildError> {
  if (!validLimitPrice(limitPrice)) return { ok: false, error: { code: "invalid-limit-price" } };
  const { timeInForce = "good-til-cancel", limits = null } = options;
  const priceScaled = BigInt(limitPrice) * SCALE / 100n;
  if (limits && (priceScaled < parseScaled(limits.priceMinimum) || priceScaled % parseScaled(limits.priceIncrement) !== 0n)) {
    return { ok: false, error: { code: "invalid-limit-price" } };
  }
  const increment = limits ? parseScaled(limits.quantityIncrement) : DEFAULT_INCREMENT;
  const affordable = BigInt(approved.notional) * SCALE / BigInt(limitPrice);
  const quantityScaled = affordable - (affordable % increment);
  const minimum = limits ? parseScaled(limits.quantityMinimum) : DEFAULT_INCREMENT;
  if (quantityScaled === 0n || quantityScaled < minimum) return { ok: false, error: { code: "quantity-below-minimum" } };
  const decimals = limits ? decimalPlaces(limits.quantityIncrement) : MIN_DISPLAY_DECIMALS;
  const priceDecimals = limits ? decimalPlaces(limits.priceIncrement) : MIN_DISPLAY_DECIMALS;
  return {
    ok: true,
    value: {
      symbol: approved.instrumentSymbol,
      orderType: "limit",
      side: "buy",
      quantity: formatScaled(quantityScaled, decimals),
      price: formatScaled(priceScaled, priceDecimals),
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
