import type { MarketContract, MarketEvent } from "@/features/markets";
import { marketTextTokens, type NewsProfile } from "./keywords";
import type { MatchCandidate } from "./types";

const TITLE_WEIGHT = 1;
const LABEL_WEIGHT = 2;
const ALIAS_MULTIPLIER = 2;
export const MIN_MATCH_SCORE = 2;

export function scoreContract(profile: NewsProfile, event: MarketEvent, contract: MarketContract): MatchCandidate {
  const titleTokens = marketTextTokens(event.title);
  const labelTokens = marketTextTokens(contract.label);
  let score = 0;
  const matchedTokens: string[] = [];
  for (const token of profile.tokens) {
    const titleScore = titleTokens.has(token) ? TITLE_WEIGHT * (profile.aliasKeywords.has(token) ? ALIAS_MULTIPLIER : 1) : 0;
    const labelScore = labelTokens.has(token) ? LABEL_WEIGHT : 0;
    if (titleScore + labelScore > 0) {
      score += titleScore + labelScore;
      matchedTokens.push(token);
    }
  }
  return { eventTicker: event.ticker, eventTitle: event.title, contract, score, matchedTokens };
}

export function compareCandidates(a: MatchCandidate, b: MatchCandidate): number {
  return b.score - a.score || a.contract.instrumentSymbol.localeCompare(b.contract.instrumentSymbol);
}
