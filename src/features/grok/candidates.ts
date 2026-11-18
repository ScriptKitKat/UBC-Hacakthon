import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { marketTextTokens, profileNews } from "@/features/matcher";
import type { PostCandidate } from "./types";

export const MAX_EVENTS = 60;
export const MAX_CONTRACTS_PER_EVENT = 8;
const EVENTS_PER_PAGE = 100;
const MAX_SPORTS_PAGES = 4;
const MIN_SPORTS_SHARED_TOKENS = 2;
const SPORTS_CATEGORY = "Sports";
const UNIVERSE_TTL_MS = 60_000;
const EVEN_ODDS_CENTS = 50;

type SearchClient = Pick<GeminiMarketsClient, "searchEvents">;

export function isIntradayEvent(event: Pick<MarketEvent, "ticker" | "title">): boolean {
  return /^[A-Z]+\d+M\d/u.test(event.ticker) || /\btoday at\b/iu.test(event.title);
}

function isOpen(contract: MarketContract): boolean {
  return contract.status === "active" && contract.marketState === "open" && contract.prices.buyYesCents !== null;
}

function overlap(tokens: ReadonlySet<string>, text: string): number {
  let shared = 0;
  for (const token of marketTextTokens(text)) {
    if (tokens.has(token)) shared += 1;
  }
  return shared;
}

function pickContracts(event: MarketEvent, tokens: ReadonlySet<string>): readonly MarketContract[] {
  return event.contracts
    .filter(isOpen)
    .map((contract) => ({
      contract,
      relevance: overlap(tokens, contract.label),
      distance: Math.abs((contract.prices.buyYesCents ?? EVEN_ODDS_CENTS) - EVEN_ODDS_CENTS),
    }))
    .sort((a, b) => b.relevance - a.relevance || a.distance - b.distance)
    .slice(0, MAX_CONTRACTS_PER_EVENT)
    .map(({ contract }) => contract);
}

export function selectCandidates(events: readonly MarketEvent[], postText: string): readonly PostCandidate[] {
  const tokens = profileNews(postText).tokens;
  return events
    .filter((event) => event.status === "active" && !isIntradayEvent(event))
    .map((event) => ({ event, relevance: overlap(tokens, event.title) }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_EVENTS)
    .flatMap(({ event }) =>
      pickContracts(event, tokens).map((contract) => ({
        eventTicker: event.ticker,
        eventTitle: event.title,
        eventStatus: event.status,
        category: event.category,
        contract,
      })),
    );
}

export interface CandidateSource {
  readonly eventsFor: (postText: string) => Promise<readonly MarketEvent[]>;
}

export interface CandidateSourceOptions {
  readonly markets: SearchClient;
  readonly categories: readonly string[];
  readonly now: () => Date;
}

interface Universe {
  readonly news: readonly MarketEvent[];
  readonly sports: readonly MarketEvent[];
}

export function createCandidateSource(options: CandidateSourceOptions): CandidateSource {
  const { markets, categories, now } = options;
  let cached: { readonly at: number; readonly universe: Promise<Universe> } | undefined;

  async function loadNews(): Promise<readonly MarketEvent[]> {
    const pages = await Promise.all(
      categories
        .filter((category) => category.toLowerCase() !== SPORTS_CATEGORY.toLowerCase())
        .map((category) => markets.searchEvents({ category, limit: EVENTS_PER_PAGE })),
    );
    return pages.flatMap((page) => (page.ok ? page.value.events : []));
  }

  async function loadSports(): Promise<readonly MarketEvent[]> {
    const events: MarketEvent[] = [];
    for (let page = 0; page < MAX_SPORTS_PAGES; page += 1) {
      const result = await markets.searchEvents({ category: SPORTS_CATEGORY, limit: EVENTS_PER_PAGE, offset: page * EVENTS_PER_PAGE });
      if (!result.ok) break;
      events.push(...result.value.events);
      if (events.length >= result.value.total || result.value.events.length === 0) break;
    }
    return events;
  }

  async function loadUniverse(): Promise<Universe> {
    const [news, sports] = await Promise.all([loadNews(), loadSports()]);
    return { news, sports };
  }

  function universe(): Promise<Universe> {
    const nowMs = now().getTime();
    if (cached && nowMs - cached.at < UNIVERSE_TTL_MS) return cached.universe;
    const loading = loadUniverse();
    cached = { at: nowMs, universe: loading };
    void loading.then((loaded) => {
      if (loaded.news.length === 0 && cached?.universe === loading) cached = undefined;
    });
    return loading;
  }

  return {
    async eventsFor(postText) {
      const tokens = profileNews(postText).tokens;
      const { news, sports } = await universe();
      return [...news, ...sports.filter((event) => overlap(tokens, event.title) >= MIN_SPORTS_SHARED_TOKENS)];
    },
  };
}
