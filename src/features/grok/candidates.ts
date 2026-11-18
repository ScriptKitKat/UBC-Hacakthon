import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { isIntradayEvent, marketTextTokens, profileNews, sportsSearchTerms } from "@/features/matcher";
import type { PostCandidate } from "./types";

export const MAX_EVENTS = 60;
export const MAX_CONTRACTS_PER_EVENT = 8;
const EVENTS_PER_PAGE = 100;
const MAX_PAGES_PER_CATEGORY = 3;
const SPORTS_CATEGORY = "Sports";
export const CARD_CATEGORIES: readonly string[] = ["Economics", "Politics", "Tech", "Culture", "Crypto", "Commodities", SPORTS_CATEGORY];
const UNIVERSE_TTL_MS = 60_000;
const EVEN_ODDS_CENTS = 50;

type SearchClient = Pick<GeminiMarketsClient, "searchEvents">;

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

export function createCandidateSource(options: CandidateSourceOptions): CandidateSource {
  const { markets, categories, now } = options;
  let cachedNews: { readonly at: number; readonly events: Promise<readonly MarketEvent[]> } | undefined;
  const cachedSports = new Map<string, { readonly at: number; readonly events: Promise<readonly MarketEvent[]> }>();

  async function loadCategory(category: string): Promise<readonly MarketEvent[]> {
    const events: MarketEvent[] = [];
    for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page += 1) {
      const result = await markets.searchEvents({ category, limit: EVENTS_PER_PAGE, offset: page * EVENTS_PER_PAGE });
      if (!result.ok) break;
      events.push(...result.value.events);
      if (events.length >= result.value.total || result.value.events.length === 0) break;
    }
    return events;
  }

  async function loadNews(): Promise<readonly MarketEvent[]> {
    const pages = await Promise.all(categories.filter((category) => category.toLowerCase() !== SPORTS_CATEGORY.toLowerCase()).map(loadCategory));
    return pages.flat();
  }

  async function loadSports(term: string): Promise<readonly MarketEvent[]> {
    const result = await markets.searchEvents({ category: SPORTS_CATEGORY, search: term, limit: EVENTS_PER_PAGE });
    return result.ok ? result.value.events : [];
  }

  function news(): Promise<readonly MarketEvent[]> {
    const nowMs = now().getTime();
    if (cachedNews && nowMs - cachedNews.at < UNIVERSE_TTL_MS) return cachedNews.events;
    const loading = loadNews();
    cachedNews = { at: nowMs, events: loading };
    void loading.then((loaded) => {
      if (loaded.length === 0 && cachedNews?.events === loading) cachedNews = undefined;
    });
    return loading;
  }

  function sports(term: string): Promise<readonly MarketEvent[]> {
    const nowMs = now().getTime();
    const hit = cachedSports.get(term);
    if (hit && nowMs - hit.at < UNIVERSE_TTL_MS) return hit.events;
    const loading = loadSports(term);
    cachedSports.set(term, { at: nowMs, events: loading });
    return loading;
  }

  return {
    async eventsFor(postText) {
      const sportsCategoryEnabled = categories.some((category) => category.toLowerCase() === SPORTS_CATEGORY.toLowerCase());
      const [newsEvents, sportsPages] = await Promise.all([
        news(),
        Promise.all(sportsCategoryEnabled ? sportsSearchTerms(postText).map(sports) : []),
      ]);
      const unique = new Map([...newsEvents, ...sportsPages.flat()].map((event) => [event.ticker, event]));
      return [...unique.values()];
    },
  };
}
