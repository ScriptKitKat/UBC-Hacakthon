import type { GeminiMarketsClient } from "@/features/markets";
import { allowAll, matchNews } from "@/features/matcher";
import { createCandidateSource, isIntradayEvent, selectCandidates } from "./candidates";
import type { GrokSettings } from "./env";
import { buildRequestBody, parseCompletion, trimWhy } from "./request";
import type { PostCandidate, PostInput, PostMatcher, PostMatchResult } from "./types";

export const MIN_CONFIDENCE = 0.6;
const GROK_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8000;
const SCORE_FOR_FULL_CONFIDENCE = 8;
const MAX_FALLBACK_CONFIDENCE = 0.95;
const FALLBACK_TOKENS_SHOWN = 3;

export interface PostMatcherOptions {
  readonly markets: Pick<GeminiMarketsClient, "searchEvents">;
  readonly settings: GrokSettings;
  readonly categories: readonly string[];
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly timeoutMs?: number;
}

function mentionedWords(text: string, tokens: readonly string[]): readonly string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return tokens
    .slice(0, FALLBACK_TOKENS_SHOWN)
    .map((token) => words.find((word) => word.startsWith(token)) ?? token);
}

function noMatch(matchedBy: "grok" | "keywords", reason: string): PostMatchResult {
  return { kind: "no-match", matchedBy, reason };
}

export function createPostMatcher(options: PostMatcherOptions): PostMatcher {
  const { markets, settings, now } = options;
  const source = createCandidateSource({ markets, categories: options.categories, now });

  async function askGrok(apiKey: string, post: PostInput, candidates: readonly PostCandidate[]) {
    try {
      const response = await options.fetch(GROK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildRequestBody(settings.model, post, candidates)),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      return parseCompletion(await response.json());
    } catch {
      return undefined;
    }
  }

  async function matchWithGrok(apiKey: string, post: PostInput): Promise<PostMatchResult | undefined> {
    let candidates: readonly PostCandidate[];
    try {
      candidates = selectCandidates(await source.eventsFor(post.text), post.text);
    } catch {
      return undefined;
    }
    if (candidates.length === 0) return undefined;
    const answer = await askGrok(apiKey, post, candidates);
    if (!answer) return undefined;
    const picked = answer.pick
      ? candidates.find((candidate) => candidate.contract.instrumentSymbol === answer.pick?.instrumentSymbol)
      : undefined;
    if (!picked) return noMatch("grok", "Grok found no live market this post moves.");
    if (answer.confidence < MIN_CONFIDENCE) return noMatch("grok", "Grok was not confident enough in a market for this post.");
    return { kind: "matched", matchedBy: "grok", confidence: answer.confidence, why: trimWhy(answer.why), candidate: picked };
  }

  async function matchWithKeywords(post: PostInput): Promise<PostMatchResult> {
    const result = await matchNews({ id: post.id, text: post.text, postedAt: now() }, { client: markets, allowlist: allowAll });
    if (result.kind === "no-match") return noMatch("keywords", result.reason);
    const best = [result.best, ...result.alternatives].find(
      (candidate) => candidate.contract.prices.buyYesCents !== null && !isIntradayEvent({ ticker: candidate.eventTicker, title: candidate.eventTitle }),
    );
    if (!best) return noMatch("keywords", "No tradeable market matches this post.");
    const confidence = Math.min(MAX_FALLBACK_CONFIDENCE, best.score / SCORE_FOR_FULL_CONFIDENCE);
    if (confidence < MIN_CONFIDENCE) return noMatch("keywords", "No market matches this post closely enough.");
    const mentioned = mentionedWords(post.text, best.matchedTokens).join(", ");
    return {
      kind: "matched",
      matchedBy: "keywords",
      confidence,
      why: trimWhy(`Headline mentions ${mentioned}; this market prices ${best.eventTitle}.`),
      candidate: {
        eventTicker: best.eventTicker,
        eventTitle: best.eventTitle,
        eventStatus: best.eventStatus,
        category: best.eventCategory,
        contract: best.contract,
      },
    };
  }

  return {
    async matchPost(post) {
      const grok = settings.apiKey === undefined ? undefined : await matchWithGrok(settings.apiKey, post);
      return grok ?? matchWithKeywords(post);
    },
  };
}
