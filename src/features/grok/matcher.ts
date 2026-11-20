import type { GeminiMarketsClient, MarketEvent } from "@/features/markets";
import type { LlmCompleter, LlmProvider } from "@/features/llm";
import { matchPostToEvents, trimWhy } from "@/features/matcher";
import { createCandidateSource, selectCandidates } from "./candidates";
import { buildUserPrompt, parseAnswer, RESPONSE_SCHEMA, SYSTEM_PROMPT } from "./request";
import type { PostCandidate, PostInput, PostMatcher, PostMatchResult } from "./types";

export const MIN_CONFIDENCE = 0.6;

export interface PostMatcherOptions {
  readonly markets: Pick<GeminiMarketsClient, "searchEvents">;
  readonly llm: LlmCompleter | undefined;
  readonly categories: readonly string[];
  readonly now: () => Date;
  readonly timeoutMs?: number;
}

function noMatch(matchedBy: LlmProvider | "keywords", reason: string): PostMatchResult {
  return { kind: "no-match", matchedBy, reason };
}

export function createPostMatcher(options: PostMatcherOptions): PostMatcher {
  const { markets, llm, now } = options;
  const source = createCandidateSource({ markets, categories: options.categories, now });

  async function matchWithLlm(post: PostInput): Promise<PostMatchResult | undefined> {
    if (llm === undefined) return undefined;
    let candidates: readonly PostCandidate[];
    try {
      candidates = selectCandidates(await source.eventsFor(post.text), post.text);
    } catch {
      return undefined;
    }
    if (candidates.length === 0) return undefined;
    let answer: ReturnType<typeof parseAnswer>;
    try {
      answer = parseAnswer(await llm.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(post, candidates),
        schemaName: "post_market_pick",
        schema: RESPONSE_SCHEMA,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }));
    } catch {
      return undefined;
    }
    if (!answer) return undefined;
    const picked = answer.pick
      ? candidates.find((candidate) => candidate.contract.instrumentSymbol === answer.pick?.instrumentSymbol)
      : undefined;
    const providerName = llm.provider === "claude" ? "Claude" : "Grok";
    if (!picked) return noMatch(llm.provider, `${providerName} found no live market this post moves.`);
    if (answer.confidence < MIN_CONFIDENCE) return noMatch(llm.provider, `${providerName} was not confident enough in a market for this post.`);
    return { kind: "matched", matchedBy: llm.provider, confidence: answer.confidence, why: trimWhy(answer.why), candidate: picked };
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
      const match = llm === undefined ? undefined : await matchWithLlm(post);
      return match ?? matchWithKeywords(post);
    },
  };
}
