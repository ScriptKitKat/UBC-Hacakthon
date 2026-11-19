export interface PayoutQuote {
  readonly kind: "quote";
  readonly priceCents: number;
  readonly stakeCents: number;
  readonly costCents: number;
  readonly contracts: number;
  readonly payoutCents: number;
  readonly profitCents: number;
  readonly returnPercent: number;
  readonly breakEvenPercent: number;
}

export type PayoutResult =
  | PayoutQuote
  | { readonly kind: "no-price" }
  | { readonly kind: "invalid-stake" }
  | { readonly kind: "below-minimum"; readonly minimumContracts: number };

export interface QuantityLimits {
  readonly quantityIncrementHundredths: number;
  readonly quantityMinimumHundredths: number;
}

const CENTS_PER_CONTRACT = 100;
const HUNDREDTHS_PER_CONTRACT = 100;
const DEFAULT_LIMITS: QuantityLimits = { quantityIncrementHundredths: 1, quantityMinimumHundredths: 1 };

function validPrice(priceCents: number | null): priceCents is number {
  return priceCents !== null && Number.isFinite(priceCents) && priceCents > 0 && priceCents <= CENTS_PER_CONTRACT;
}

function validLimits(limits: QuantityLimits): boolean {
  return Number.isSafeInteger(limits.quantityIncrementHundredths) && limits.quantityIncrementHundredths > 0
    && Number.isSafeInteger(limits.quantityMinimumHundredths) && limits.quantityMinimumHundredths >= 0;
}

export function payoutFor(priceCents: number | null, stakeCents: number, limits: QuantityLimits = DEFAULT_LIMITS): PayoutResult {
  if (!validPrice(priceCents) || !validLimits(limits)) return { kind: "no-price" };
  if (!Number.isSafeInteger(stakeCents) || stakeCents <= 0) return { kind: "invalid-stake" };
  const affordable = Math.floor((stakeCents * HUNDREDTHS_PER_CONTRACT) / priceCents + 1e-9);
  const hundredths = affordable - (affordable % limits.quantityIncrementHundredths);
  if (hundredths === 0 || hundredths < limits.quantityMinimumHundredths) {
    return { kind: "below-minimum", minimumContracts: limits.quantityMinimumHundredths / HUNDREDTHS_PER_CONTRACT };
  }
  const costCents = (hundredths * priceCents) / HUNDREDTHS_PER_CONTRACT;
  const payoutCents = hundredths;
  const profitCents = payoutCents - costCents;
  return {
    kind: "quote",
    priceCents,
    stakeCents,
    costCents,
    contracts: hundredths / HUNDREDTHS_PER_CONTRACT,
    payoutCents,
    profitCents,
    returnPercent: (profitCents / costCents) * 100,
    breakEvenPercent: priceCents,
  };
}
