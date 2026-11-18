import type { GeminiMarketsClient, MarketEvent, MarketsError } from "@/features/markets";
import { profileNews } from "./keywords";
import { compareCandidates, MIN_MATCH_SCORE, scoreContract } from "./score";
import type { Allowlist, MatchCandidate, MatchResult, NewsItem } from "./types";

const MAX_ALTERNATIVES = 3;

export interface MatchOptions {
  readonly client: Pick<GeminiMarketsClient, "searchEvents">;
  readonly allowlist: Allowlist;
}

function describeError(error: MarketsError): string {
  return error.kind === "http" ? `HTTP ${String(error.status)}` : error.kind === "network" ? error.message : "unexpected response";
}

function noMatch(reason: string): MatchResult {
  return { kind: "no-match", reason };
}

export async function matchNews(news: NewsItem, options: MatchOptions): Promise<MatchResult> {
  const profile = profileNews(news.text);
  if (profile.searchKeywords.length === 0) {
    return noMatch("The post has no searchable keywords.");
  }

  const events = new Map<string, MarketEvent>();
  const failures: string[] = [];
  for (const keyword of profile.searchKeywords) {
    const result = await options.client.searchEvents({ search: keyword });
    if (result.ok) {
      for (const event of result.value.events) {
        events.set(event.ticker, event);
      }
    } else {
      failures.push(describeError(result.error));
    }
  }

  const searched = profile.searchKeywords.join(", ");
  if (events.size === 0) {
    return noMatch(
      failures.length > 0
        ? `Market search failed (${failures[0] ?? "unknown"}).`
        : `No active markets found for: ${searched}.`,
    );
  }

  const candidates = new Map<string, MatchCandidate>();
  for (const event of events.values()) {
    if (event.status !== "active") continue;
    for (const contract of event.contracts) {
      if (contract.status === "active" && contract.marketState === "open") {
        candidates.set(contract.instrumentSymbol, scoreContract(profile, event, contract));
      }
    }
  }
  if (candidates.size === 0) {
    return noMatch(`Markets found for ${searched} have no open contracts.`);
  }

  const relevant = [...candidates.values()].filter((candidate) => candidate.score >= MIN_MATCH_SCORE);
  if (relevant.length === 0) {
    return noMatch(`No open contract is relevant enough to the post (searched: ${searched}).`);
  }

  const allowed =
    options.allowlist.kind === "allowAll"
      ? relevant
      : relevant.filter((candidate) => options.allowlist.kind === "only" && options.allowlist.symbols.has(candidate.contract.instrumentSymbol));
  const [best, ...rest] = allowed.sort(compareCandidates);
  if (best === undefined) {
    return noMatch("Relevant markets were found but none are on the allowlist.");
  }

  return {
    kind: "matched",
    best,
    alternatives: rest.slice(0, MAX_ALTERNATIVES),
    score: best.score,
    reasons: [
      `Matched keywords: ${best.matchedTokens.join(", ")}.`,
      `Event: ${best.eventTitle} (${best.eventTicker}).`,
      `Contract: ${best.contract.label} (${best.contract.instrumentSymbol}).`,
    ],
  };
}
