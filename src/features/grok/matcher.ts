import type { GeminiMarketsClient, MarketEvent } from "@/features/markets";
import { matchPostToEvents, trimWhy } from "@/features/matcher";
import { createCandidateSource, selectCandidates } from "./candidates";
import type { GrokSettings } from "./env";
import { buildRequestBody, parseCompletion } from "./request";
import type { PostCandidate, PostInput, PostMatcher, PostMatchResult } from "./types";

export const MIN_CONFIDENCE = 0.6;
const GROK_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8000;

export interface PostMatcherOptions {
  readonly markets: Pick<GeminiMarketsClient, "searchEvents">;
  readonly settings: GrokSettings;
  readonly categories: readonly string[];
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly timeoutMs?: number;
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
    let events: readonly MarketEvent[];
    try {
      events = await source.eventsFor(post.text);
    } catch {
      return noMatch("keywords", "Market data is unavailable right now.");
    }
    const pick = matchPostToEvents(post.text, events, now());
    if (!pick || pick.confidence < MIN_CONFIDENCE) return noMatch("keywords", "No live market matches this post closely enough.");
    return {
      kind: "matched",
      matchedBy: "keywords",
      confidence: pick.confidence,
      why: pick.why,
      candidate: {
        eventTicker: pick.event.ticker,
        eventTitle: pick.event.title,
        eventStatus: pick.event.status,
        category: pick.event.category,
        contract: pick.contract,
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
