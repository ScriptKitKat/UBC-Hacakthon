export interface PayoutQuote {
  readonly kind: "quote";
  readonly priceCents: number;
  readonly stakeCents: number;
  readonly contracts: number;
  readonly payoutCents: number;
  readonly profitCents: number;
  readonly returnPercent: number;
  readonly breakEvenPercent: number;
}

export type PayoutResult =
  | PayoutQuote
  | { readonly kind: "no-price" }
  | { readonly kind: "invalid-stake" };

const CENTS_PER_CONTRACT = 100;
const HUNDREDTHS_PER_CONTRACT = 100;

function validPrice(priceCents: number | null): priceCents is number {
  return priceCents !== null && Number.isFinite(priceCents) && priceCents > 0 && priceCents <= CENTS_PER_CONTRACT;
}

export function payoutFor(priceCents: number | null, stakeCents: number): PayoutResult {
  if (!validPrice(priceCents)) return { kind: "no-price" };
  if (!Number.isInteger(stakeCents) || stakeCents <= 0) return { kind: "invalid-stake" };
  const hundredths = Math.floor((stakeCents * HUNDREDTHS_PER_CONTRACT) / priceCents + 1e-9);
  const payoutCents = hundredths;
  const profitCents = payoutCents - stakeCents;
  return {
    kind: "quote",
    priceCents,
    stakeCents,
    contracts: hundredths / HUNDREDTHS_PER_CONTRACT,
    payoutCents,
    profitCents,
    returnPercent: (profitCents / stakeCents) * 100,
    breakEvenPercent: priceCents,
  };
}
