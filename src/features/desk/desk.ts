import { executeApproved } from "@/features/execution";
import type { ExecutionError, TradeRecord } from "@/features/execution";
import { createPostMatcher } from "@/features/grok";
import type { PostCandidate, PostInput } from "@/features/grok";
import { confirm, evaluate, marketPolicyRefusal, rollDay } from "@/features/guardrails";
import type { ApprovedTrade, Decision, Policy, PolicyState } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import type { ContractLimits, GeminiMarketsClient, MarketContract } from "@/features/markets";
import { allowAll, matchNews } from "@/features/matcher";
import type { MatchCandidate, MatchResult, NewsItem } from "@/features/matcher";
import { instrumentSymbol, usdCents } from "@/shared";
import type { FeedSettings } from "./config";
import type {
  DecisionLogEntry,
  DeskSnapshot,
  FeedMarketView,
  FeedMatch,
  FeedQuote,
  InstrumentSymbol,
  LedgerView,
  MarketView,
  MatchView,
  NewsView,
  Outcome,
  PendingView,
  PolicyView,
  PricePoint,
  TradeIntent,
  TradeSource,
  UsdCents,
} from "@/shared";

const LOG_LIMIT = 200;
const HISTORY_LIMIT = 90;
const MATCH_CACHE_LIMIT = 300;
const MATCH_CACHE_TTL_MS = 10 * 60 * 1000;

type PendingTrade = Extract<Decision, { kind: "needs-approval" }>;

export interface DeskDeps {
  readonly policy: Policy;
  readonly markets: Pick<GeminiMarketsClient, "searchEvents" | "getEvent">;
  readonly ledger: UsdcLedger;
  readonly ledgerView: LedgerView;
  readonly feed: FeedSettings;
  readonly fetch?: typeof fetch;
  readonly now: () => Date;
  readonly idGen: () => string;
}

export interface FeedBuyRequest {
  readonly instrumentSymbol: string;
  readonly outcome: Outcome;
  readonly notionalCents: number;
}

export interface ProposeRequest {
  readonly instrumentSymbol: string;
  readonly outcome: Outcome;
  readonly notionalCents: number;
  readonly source: TradeSource;
  readonly senderId: string;
}

export type ConfirmResult =
  | { readonly ok: true; readonly entry: DecisionLogEntry }
  | { readonly ok: false; readonly error: "unknown-intent" };

export interface Desk {
  readonly submitNews: (news: NewsItem) => Promise<MatchView>;
  readonly matchPost: (post: PostInput) => Promise<FeedMatch>;
  readonly quote: (symbol: string) => Promise<FeedQuote | undefined>;
  readonly buyFromFeed: (request: FeedBuyRequest) => Promise<DecisionLogEntry>;
  readonly confirmFromFeed: (intentId: string) => Promise<ConfirmResult>;
  readonly proposeTrade: (request: ProposeRequest) => Promise<DecisionLogEntry>;
  readonly confirmPending: (intentId: string, approverId: string) => Promise<ConfirmResult>;
  readonly setKillSwitch: (on: boolean) => void;
  readonly getSnapshot: () => Promise<DeskSnapshot>;
}

interface LiveMarket {
  readonly eventStatus: string;
  readonly eventTicker: string;
  readonly eventTitle: string;
  readonly category: string;
  readonly contract: MarketContract;
}

interface Quote {
  readonly instrumentSymbol: InstrumentSymbol;
  readonly status: string;
  readonly eventStatus: string;
  readonly category: string;
  readonly marketState: string;
  readonly limitPrice: UsdCents;
  readonly limits: ContractLimits | null;
}

interface PendingRecord {
  readonly decision: PendingTrade;
  readonly intent: TradeIntent;
}

function sourceDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

function newsView(news: NewsItem): NewsView {
  const domain = sourceDomain(news.url);
  return {
    id: news.id,
    text: news.text,
    postedAt: news.postedAt.toISOString(),
    ...(news.url ? { url: news.url } : {}),
    ...(domain ? { sourceDomain: domain } : {}),
    ...(news.author ? { author: news.author } : {}),
  };
}

function marketView(market: LiveMarket): MarketView {
  return {
    eventTicker: market.eventTicker,
    eventTitle: market.eventTitle,
    contractLabel: market.contract.label,
    instrumentSymbol: market.contract.instrumentSymbol,
    yesCents: market.contract.prices.buyYesCents,
    noCents: market.contract.prices.buyNoCents,
    marketState: market.contract.marketState,
  };
}

function candidateMarket(candidate: MatchCandidate): LiveMarket {
  return {
    eventStatus: candidate.eventStatus,
    eventTicker: candidate.eventTicker,
    eventTitle: candidate.eventTitle,
    category: candidate.eventCategory,
    contract: candidate.contract,
  };
}

function postCandidateMarket(candidate: PostCandidate): LiveMarket {
  return {
    eventStatus: candidate.eventStatus,
    eventTicker: candidate.eventTicker,
    eventTitle: candidate.eventTitle,
    category: candidate.category,
    contract: candidate.contract,
  };
}

function matchView(match: MatchResult | undefined, best: LiveMarket | undefined): MatchView {
  if (!match) return { kind: "no-news" };
  if (match.kind === "no-match") return { kind: "no-match", reason: match.reason };
  return { kind: "matched", market: marketView(best ?? candidateMarket(match.best)), reasons: match.reasons };
}

function quoteFor(market: LiveMarket | undefined, outcome: Outcome): Quote | undefined {
  if (!market) return undefined;
  const { buyYesCents, buyNoCents } = market.contract.prices;
  const { instrumentSymbol, status, marketState, limits } = market.contract;
  return { instrumentSymbol, status, marketState, eventStatus: market.eventStatus, category: market.category,
    limitPrice: usdCents((outcome === "yes" ? buyYesCents : buyNoCents) ?? 0), limits };
}

function failureReason(error: ExecutionError): string {
  switch (error.code) {
    case "ledger-not-configured": return "The ledger isn't configured, so I did not place the trade.";
    case "invalid-limit-price": return "I couldn't get a valid price for this market, so I did not place the trade.";
    case "quantity-below-minimum": return "That amount is below the market's minimum order size, so I did not place the trade.";
    case "debit-unconfirmed": return "The payment could not be confirmed, so those funds stay reserved until it is checked.";
    case "unsafe-ledger-network": return "The ledger network is not approved for test payments.";
    case "recipient-ata-missing": return "The vault recipient has no USDC account yet, so I did not place the trade.";
    case "notional-overflow": return "The trade amount exceeds the ledger limit.";
    case "invalid-notional":
    case "debit-preparation-failed":
    case "debit-rejected":
    case "balance-failed": return "The ledger payment failed, so I did not place the trade.";
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

export function createDesk(deps: DeskDeps): Desk {
  const { markets, ledger, now, idGen } = deps;
  const postMatcher = createPostMatcher({
    markets,
    settings: deps.feed.grok,
    categories: [...deps.policy.marketCategories],
    fetch: deps.fetch ?? fetch,
    now,
  });
  let policy = deps.policy;
  let state: PolicyState = {
    day: now().toISOString().slice(0, 10),
    spentToday: usdCents(0),
    reservedToday: usdCents(0),
    seenIntentIds: new Set(),
  };
  let current: { readonly news: NewsItem; readonly match: MatchResult } | undefined;
  let log: readonly DecisionLogEntry[] = [];
  const pending = new Map<string, PendingRecord>();
  const tickers = new Map<InstrumentSymbol, string>();
  const priceHistory = new Map<InstrumentSymbol, PricePoint[]>();
  const matchCache = new Map<string, { readonly at: number; readonly match: Promise<FeedMatch> }>();

  function recordPrice(market: LiveMarket): void {
    const yesCents = market.contract.prices.buyYesCents;
    if (yesCents === null) return;
    const points = priceHistory.get(market.contract.instrumentSymbol) ?? [];
    points.push({ at: now().toISOString(), yesCents });
    priceHistory.set(market.contract.instrumentSymbol, points.slice(-HISTORY_LIMIT));
  }

  function tradeBlockedReason(market: LiveMarket): string | undefined {
    const { contract } = market;
    const refusal = marketPolicyRefusal(policy, contract.instrumentSymbol, market.category);
    if (refusal) return refusal;
    const open = market.eventStatus === "active" && contract.status === "active" && contract.marketState === "open";
    if (!open) return "This market isn't open for trading.";
    return contract.prices.buyYesCents === null || contract.prices.buyNoCents === null ? "This contract has no live price right now." : undefined;
  }

  function feedMarketView(market: LiveMarket): FeedMarketView {
    const { prices } = market.contract;
    const blocked = tradeBlockedReason(market);
    return {
      ...marketView(market),
      category: market.category,
      impliedYesPercent: prices.buyYesCents,
      bestBidCents: prices.bestBidCents,
      bestAskCents: prices.bestAskCents,
      lastTradeCents: prices.lastTradeCents,
      tradeable: blocked === undefined,
      ...(blocked === undefined ? {} : { tradeBlockedReason: blocked }),
    };
  }

  function record(entry: Omit<DecisionLogEntry, "entryId" | "at">): DecisionLogEntry {
    const complete = { ...entry, entryId: idGen(), at: now().toISOString() };
    log = [complete, ...log].slice(0, LOG_LIMIT);
    return complete;
  }

  function tradeFields(intent: TradeIntent) {
    return {
      intentId: intent.intentId,
      symbol: intent.instrumentSymbol,
      outcome: intent.outcome,
      notionalCents: intent.notional,
      senderId: intent.senderId,
      source: intent.source,
    };
  }

  async function resolveMarket(symbol: InstrumentSymbol, refresh = false): Promise<LiveMarket | undefined> {
    const eventTicker = tickers.get(symbol);
    if (!eventTicker) return undefined;
    const result = await markets.getEvent(eventTicker, { refresh });
    if (!result.ok) return undefined;
    const contract = result.value.contracts.find((candidate) => candidate.instrumentSymbol === symbol);
    if (!contract) return undefined;
    const market = { eventTicker, eventStatus: result.value.status, eventTitle: result.value.title, category: result.value.category, contract };
    recordPrice(market);
    return market;
  }

  async function computeFeedMatch(post: PostInput): Promise<FeedMatch> {
    const result = await postMatcher.matchPost(post);
    if (result.kind === "no-match") return { kind: "no-match", postId: post.id, matchedBy: result.matchedBy, reason: result.reason };
    const symbol = result.candidate.contract.instrumentSymbol;
    tickers.set(symbol, result.candidate.eventTicker);
    const market = (await resolveMarket(symbol)) ?? postCandidateMarket(result.candidate);
    return {
      kind: "matched",
      postId: post.id,
      matchedBy: result.matchedBy,
      confidence: result.confidence,
      why: result.why,
      market: feedMarketView(market),
    };
  }

  function cachedFeedMatch(post: PostInput): Promise<FeedMatch> {
    const nowMs = now().getTime();
    const hit = matchCache.get(post.id);
    if (hit && nowMs - hit.at < MATCH_CACHE_TTL_MS) {
      matchCache.delete(post.id);
      matchCache.set(post.id, hit);
      return hit.match;
    }
    const match = computeFeedMatch(post);
    matchCache.set(post.id, { at: nowMs, match });
    for (const oldest of matchCache.keys()) {
      if (matchCache.size <= MATCH_CACHE_LIMIT) break;
      matchCache.delete(oldest);
    }
    match.catch(() => matchCache.delete(post.id));
    return match;
  }

  function reserve(approved: ApprovedTrade): void {
    const rolled = rollDay(state, now());
    state = {
      ...rolled,
      reservedToday: usdCents(rolled.reservedToday + approved.notional),
      seenIntentIds: new Set([...rolled.seenIntentIds, approved.intentId]),
    };
  }

  function settle(trade: TradeRecord): void {
    const rolled = rollDay(state, now());
    const released = usdCents(Math.max(0, rolled.reservedToday - trade.notional));
    if (trade.kind === "paper-order") {
      state = { ...rolled, reservedToday: released, spentToday: usdCents(rolled.spentToday + trade.notional) };
    } else if (trade.error.code !== "debit-unconfirmed") {
      state = { ...rolled, reservedToday: released };
    }
  }

  async function execute(approved: ApprovedTrade, intent: TradeIntent, quote: Quote): Promise<DecisionLogEntry> {
    reserve(approved);
    const trade = await executeApproved(approved, { ledger, now, idGen, limitPrice: quote.limitPrice, limits: quote.limits });
    settle(trade);
    if (trade.kind === "execution-failed") {
      return record({
        ...tradeFields(intent),
        kind: "execution-failed",
        code: trade.error.code,
        spokenReason: failureReason(trade.error),
      });
    }
    const { ticket, debit } = trade;
    return record({
      ...tradeFields(intent),
      kind: "approve",
      spokenReason: trade.spokenReason,
      signature: debit.signature,
      explorerUrl: debit.explorerUrl,
      ticket: {
        ticketId: ticket.ticketId,
        symbol: ticket.payload.symbol,
        outcome: ticket.payload.outcome,
        quantity: ticket.payload.quantity,
        price: ticket.payload.price,
        mode: ticket.mode,
      },
    });
  }

  async function proposeTrade(request: ProposeRequest): Promise<DecisionLogEntry> {
    const symbol = instrumentSymbol(request.instrumentSymbol);
    const intent: TradeIntent = {
      intentId: idGen(),
      instrumentSymbol: symbol,
      outcome: request.outcome,
      notional: usdCents(request.notionalCents),
      source: request.source,
      senderId: request.senderId,
      createdAt: now(),
    };
    const quote = quoteFor(await resolveMarket(symbol, true), intent.outcome);
    const decision = evaluate(intent, quote, policy, state, now());
    switch (decision.kind) {
      case "refuse":
        return record({ ...tradeFields(intent), kind: "refuse", code: decision.code, spokenReason: decision.spokenReason });
      case "needs-approval":
        pending.set(intent.intentId, { decision, intent });
        return record({ ...tradeFields(intent), kind: "needs-approval", spokenReason: decision.spokenReason });
      case "approve":
        if (!quote) throw new Error("Approval requires a quote");
        return execute(decision, intent, quote);
      default: {
        const exhaustive: never = decision;
        return exhaustive;
      }
    }
  }

  async function confirmPending(intentId: string, approverId: string): Promise<ConfirmResult> {
    const waiting = pending.get(intentId);
    if (!waiting) return { ok: false, error: "unknown-intent" };
    const quote = quoteFor(await resolveMarket(waiting.intent.instrumentSymbol, true), waiting.intent.outcome);
    const confirmed = confirm(waiting.decision, approverId, quote, policy, state, now());
    if (confirmed.kind === "refuse") {
      if (confirmed.code === "duplicate-intent") pending.delete(intentId);
      return {
        ok: true,
        entry: record({ ...tradeFields(waiting.intent), kind: "refuse", code: confirmed.code, spokenReason: confirmed.spokenReason }),
      };
    }
    if (!pending.delete(intentId)) return { ok: false, error: "unknown-intent" };
    if (!quote) throw new Error("Approval requires a quote");
    return { ok: true, entry: await execute(confirmed, waiting.intent, quote) };
  }

  return {
    async submitNews(news) {
      const match = await matchNews(news, { client: markets, allowlist: allowAll });
      current = { news, match };
      if (match.kind === "matched") {
        for (const candidate of [match.best, ...match.alternatives]) {
          tickers.set(candidate.contract.instrumentSymbol, candidate.eventTicker);
        }
      }
      return matchView(match, undefined);
    },

    matchPost: cachedFeedMatch,

    async quote(symbol) {
      const market = await resolveMarket(instrumentSymbol(symbol));
      if (!market) return undefined;
      return { market: feedMarketView(market), history: [...(priceHistory.get(market.contract.instrumentSymbol) ?? [])] };
    },

    buyFromFeed(request) {
      return proposeTrade({ ...request, source: "feed", senderId: deps.feed.operatorId });
    },

    confirmFromFeed(intentId) {
      if (pending.get(intentId)?.intent.source !== "feed") return Promise.resolve({ ok: false, error: "unknown-intent" });
      return confirmPending(intentId, deps.feed.operatorId);
    },

    proposeTrade,

    confirmPending,

    setKillSwitch(on) {
      policy = policy.withKillSwitch(on);
    },

    async getSnapshot() {
      const rolled = rollDay(state, now());
      const best = current?.match.kind === "matched" ? await resolveMarket(current.match.best.contract.instrumentSymbol) : undefined;
      const config = policy;
      const policyView: PolicyView = {
        dailyCapCents: config.dailyCap,
        spentCents: rolled.spentToday,
        remainingCents: Math.max(0, config.dailyCap - rolled.spentToday - rolled.reservedToday),
        autoApproveMaxCents: config.autoApproveMax,
        perTradeMaxCents: config.perTradeMax,
        killSwitch: config.killSwitch,
        marketAllowlist: [...config.marketAllowlist],
        marketCategories: [...config.marketCategories],
        senderAllowlist: [...config.senderAllowlist],
      };
      const pendingViews: PendingView[] = [...pending.values()].map(({ decision, intent }) => ({
        intentId: decision.intentId,
        symbol: decision.instrumentSymbol,
        outcome: decision.outcome,
        notionalCents: decision.notional,
        senderId: intent.senderId,
        createdAt: intent.createdAt.toISOString(),
      }));
      return {
        news: current ? newsView(current.news) : null,
        match: matchView(current?.match, best),
        policy: policyView,
        pending: pendingViews,
        log,
        ledger: deps.ledgerView,
      };
    },
  };
}
