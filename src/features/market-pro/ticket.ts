export interface TicketQuote {
  readonly kind: "quote";
  readonly priceCents: number;
  readonly stakeCents: number;
  readonly shares: number;
  readonly maxPayoutCents: number;
  readonly breakEvenPercent: number;
  readonly evCents: number;
  readonly evPercent: number;
  readonly kellyFraction: number;
  readonly kellyStakeCents: number;
}

const KELLY_CAP_CENTS = 1000;

export function ticketQuote(input: {
  readonly priceCents: number;
  readonly stakeCents: number;
  readonly believedYesPercent: number;
  readonly side: "yes" | "no";
}): TicketQuote | { readonly kind: "invalid" } {
  const { priceCents, stakeCents, side } = input;
  if (!(priceCents > 0 && priceCents < 100) || !Number.isFinite(stakeCents) || stakeCents <= 0) {
    return { kind: "invalid" };
  }
  const believed = Math.min(99, Math.max(1, input.believedYesPercent));
  const probability = (side === "yes" ? believed : 100 - believed) / 100;
  const price = priceCents / 100;
  const shares = stakeCents / priceCents;
  const ev = probability * (shares * 100) - stakeCents;
  const kelly = Math.max(0, (probability - price) / (1 - price));
  return {
    kind: "quote",
    priceCents,
    stakeCents,
    shares,
    maxPayoutCents: shares * 100,
    breakEvenPercent: priceCents,
    evCents: ev,
    evPercent: stakeCents === 0 ? 0 : (ev / stakeCents) * 100,
    kellyFraction: kelly,
    kellyStakeCents: Math.min(KELLY_CAP_CENTS, kelly * KELLY_CAP_CENTS),
  };
}

export function cappedStakeCents(stakeCents: number, remainingCents: number, perTradeMaxCents: number): number {
  return Math.max(0, Math.min(stakeCents, remainingCents, perTradeMaxCents));
}

export function needsApproval(stakeCents: number, autoApproveMaxCents: number): boolean {
  return stakeCents > autoApproveMaxCents;
}
