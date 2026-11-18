import type { InstrumentSymbol } from "@/shared";
import type { MarketContract } from "@/features/markets";

export interface NewsItem {
  readonly id: string;
  readonly text: string;
  readonly url?: string;
  readonly author?: string;
  readonly postedAt: Date;
}

export type Allowlist =
  | { readonly kind: "allowAll" }
  | { readonly kind: "only"; readonly symbols: ReadonlySet<InstrumentSymbol> };

export const allowAll: Allowlist = { kind: "allowAll" };

export function allowOnly(symbols: Iterable<InstrumentSymbol>): Allowlist {
  return { kind: "only", symbols: new Set(symbols) };
}

export interface MatchCandidate {
  readonly eventStatus: string;
  readonly eventTicker: string;
  readonly eventTitle: string;
  readonly contract: MarketContract;
  readonly score: number;
  readonly matchedTokens: readonly string[];
}

export type MatchResult =
  | {
      readonly kind: "matched";
      readonly best: MatchCandidate;
      readonly alternatives: readonly MatchCandidate[];
      readonly score: number;
      readonly reasons: readonly string[];
    }
  | { readonly kind: "no-match"; readonly reason: string };
