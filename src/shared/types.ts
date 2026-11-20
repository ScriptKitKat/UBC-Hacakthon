export type Outcome = "yes" | "no";

export type TradeSource = "x" | "desk" | "feed";

declare const usdCentsBrand: unique symbol;
export type UsdCents = number & { readonly [usdCentsBrand]: true };

export function usdCents(value: number): UsdCents {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`UsdCents must be a non-negative integer, got ${String(value)}`);
  }
  return value as UsdCents;
}

declare const instrumentSymbolBrand: unique symbol;
export type InstrumentSymbol = string & { readonly [instrumentSymbolBrand]: true };

export function instrumentSymbol(value: string): InstrumentSymbol {
  if (value.length === 0) {
    throw new RangeError("InstrumentSymbol must be non-empty");
  }
  return value as InstrumentSymbol;
}

export interface TradeIntent {
  readonly intentId: string;
  readonly instrumentSymbol: InstrumentSymbol;
  readonly outcome: Outcome;
  readonly notional: UsdCents;
  readonly source: TradeSource;
  readonly senderId: string;
  readonly createdAt: Date;
  readonly seenPriceCents?: number;
}
