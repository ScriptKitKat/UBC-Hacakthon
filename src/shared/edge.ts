export const MIN_EDGE_CENTS = 3;

export type EdgeSide = "yes" | "no";

export type EdgeResult =
  | { readonly kind: "no-price" }
  | { readonly kind: "none" }
  | {
      readonly kind: "edge";
      readonly side: EdgeSide;
      readonly priceCents: number;
      readonly winPercent: number;
      readonly edgeCents: number;
      readonly averageCentsPerDollar: number;
      readonly lossesInTen: number;
    };

function candidate(side: EdgeSide, winPercent: number, priceCents: number | null) {
  if (priceCents === null || priceCents <= 0 || priceCents >= 100) return null;
  return { side, winPercent, priceCents, edgeCents: winPercent - priceCents };
}

export function edgeFor(estimatePercent: number, yesCents: number | null, noCents: number | null): EdgeResult {
  const estimate = Math.min(100, Math.max(0, estimatePercent));
  const sides = [candidate("yes", estimate, yesCents), candidate("no", 100 - estimate, noCents)].filter((item) => item !== null);
  if (sides.length === 0) return { kind: "no-price" };
  const best = sides.reduce((left, right) => (right.edgeCents > left.edgeCents ? right : left));
  if (best.edgeCents < MIN_EDGE_CENTS) return { kind: "none" };
  return {
    kind: "edge",
    side: best.side,
    priceCents: best.priceCents,
    winPercent: best.winPercent,
    edgeCents: best.edgeCents,
    averageCentsPerDollar: Math.round((best.edgeCents / best.priceCents) * 100),
    lossesInTen: Math.round((100 - best.winPercent) / 10),
  };
}
