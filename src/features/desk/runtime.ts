import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { selectLlm } from "@/features/llm";
import { createSampler, openHistoryStore } from "@/features/history";
import { createSolanaLedger, createUnconfiguredLedger, isExpectedGenesis } from "@/features/ledger";
import type { UsdcLedger } from "@/features/ledger";
import { openAgentStore, startAgentLoop, agentCycle } from "@/features/agents";
import type { AgentCycleOptions, AgentCycleReport, AgentStore } from "@/features/agents";
import { createChatter, openChatterStore } from "@/features/chatter";
import type { Chatter } from "@/features/chatter";
import { cardsForSaved, cardsForSymbols, createBrowseCache, createListCache, listBrowse, listCatalog, loadSpotPrices, openWatchlist, sparklineUpdates } from "@/features/catalog";
import type { BrowseListResult, BrowseQuery, CatalogListResult, CatalogQuery, Watchlist, WatchlistItem } from "@/features/catalog";
import type { CatalogCard, WatchlistCard } from "@/shared";
import { createGeminiMarketsClient } from "@/features/markets";
import { createMarketPro } from "@/features/market-pro";
import type { MarketPro } from "@/features/market-pro";
import { createResearch } from "@/features/research";
import type { Research } from "@/features/research";
import { createXFeed, loadXFeedSettings } from "@/features/xfeed";
import { StoreUnavailableError, nodeFileSystem, resolveDataDirectory } from "@/features/storage";
import { createNonceCodec, createX402Server, openUsedPayments, priceToBaseUnits, x402NetworkFor } from "@/features/x402";
import type { LedgerView } from "@/shared";
import { loadDeskConfig } from "./config";
import { createDeepDiveResource, createDeferredDeepDive, deepDiveUrl } from "./deep-dive-resource";
import type { DeepDiveResource } from "./deep-dive-resource";
import { createDesk } from "./desk";
import type { Desk } from "./desk";
import { openFeedOrders } from "./feed-orders";
import { startReconciliation } from "./reconciliation";
import { openDecisionLog, openMigratedSpendJournal } from "./log-store";
import { openMatchStore } from "./match-store";
import { UNDELIVERED_RECOVERY_MS, openPurchaseStore } from "./purchase-store";

const browseCache = createBrowseCache(20_000);
const listCache = createListCache(20_000);
const PAYMENT_TIMEOUT_SECONDS = 120;
let homeCatalog: HomeCatalog | undefined;
const NONCE_BYTES = 16;
const SECRET_BYTES = 32;

export type DeskAccess =
  | { readonly ok: true; readonly desk: Desk; readonly research: Research; readonly deepDive: DeepDiveResource | undefined; readonly marketPro: MarketPro; readonly chatter: Chatter | undefined }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface AgentRuntime {
  readonly store: AgentStore;
  readonly run: (agentId?: string, options?: AgentCycleOptions) => Promise<AgentCycleReport>;
}

export interface HomeCatalog {
  readonly list: (query?: CatalogQuery) => Promise<CatalogListResult>;
  readonly browse: (query?: BrowseQuery) => Promise<BrowseListResult>;
  readonly spots: (assets: readonly string[]) => Promise<Readonly<Record<string, string>>>;
  readonly sparklines: (symbols: readonly string[]) => Promise<Readonly<Record<string, { readonly sparkline: readonly number[]; readonly changePercent: number | null }>>>;
  readonly cardsFor: (symbols: readonly string[]) => Promise<readonly CatalogCard[]>;
  readonly cardsForSaved: (items: readonly WatchlistItem[]) => Promise<readonly WatchlistCard[]>;
  readonly watchlist: Watchlist;
  readonly agents: AgentRuntime;
}

export type HomeServices =
  | { readonly ok: true; readonly desk: Desk; readonly research: Research; readonly catalog: HomeCatalog; readonly marketPro: MarketPro }
  | { readonly ok: false; readonly issues: readonly string[] };

async function openOrExplain<T>(open: () => Promise<T>): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: string }> {
  try {
    return { ok: true, value: await open() };
  } catch (error) {
    if (error instanceof StoreUnavailableError) return { ok: false, issue: `storage: ${error.message}; the desk will not trade or pay until it is restored` };
    throw error;
  }
}

async function buildDesk(env: Readonly<Record<string, string | undefined>>): Promise<DeskAccess> {
  const config = loadDeskConfig(env);
  if (!config.ok) return config;
  const settings = config.value.ledger;
  let ledger: UsdcLedger = createUnconfiguredLedger();
  let ledgerView: LedgerView = { configured: false, missing: settings.configured ? [] : settings.missing };
  if (settings.configured) {
    try {
      const configured = await createSolanaLedger({
        network: { cluster: settings.cluster, rpcUrl: settings.rpcUrl },
        mint: settings.mint,
        ...(settings.testMint ? { testMint: settings.testMint } : {}),
        recipient: settings.recipient,
        keypairPath: settings.keypairPath,
      });
      ledger = configured;
      ledgerView = {
        configured: true,
        cluster: settings.cluster,
        authority: configured.authority,
        mint: settings.mint.toBase58(),
        recipient: settings.recipient.toBase58(),
      };
    } catch {
      return { ok: false, issues: ["ledger: failed to initialise"] };
    }
  }
  const researchRecipient = config.value.research.recipient;
  if (ledgerView.configured && researchRecipient?.toBase58() === ledgerView.authority) {
    return { ok: false, issues: ["research: RESEARCH_RECIPIENT must differ from the agent authority"] };
  }
  const markets = createGeminiMarketsClient({ baseUrl: config.value.geminiBaseUrl, fetch, maxInFlight: 4, minRequestIntervalMs: 100 });
  const dataDirectory = resolveDataDirectory(env, process.cwd());
  const history = await openHistoryStore({ fs: nodeFileSystem, path: join(dataDirectory, "price-history.json") });
  const connection = settings.configured && researchRecipient
    ? new Connection(settings.rpcUrl, { commitment: "confirmed", fetch: (url, init) => fetch(url, { ...init, redirect: "error" }) })
    : undefined;
  const stores = await openOrExplain(async () => {
    const decisionLog = await openDecisionLog({ fs: nodeFileSystem, path: join(dataDirectory, "decision-log.json") });
    const journal = await openMigratedSpendJournal({
      fs: nodeFileSystem,
      path: join(dataDirectory, "spend-journal.json"),
      nowIso: () => new Date().toISOString(),
    }, decisionLog.initialLog);
    return {
      decisionLog,
      journal,
      purchaseStore: await openPurchaseStore({ fs: nodeFileSystem, path: join(dataDirectory, "research-purchases.json") }),
      matchStore: await openMatchStore({ fs: nodeFileSystem, path: join(dataDirectory, "matched-posts.json") }),
      chatterStore: await openChatterStore({ fs: nodeFileSystem, path: join(dataDirectory, "x-chatter.json") }),
      feedOrders: await openFeedOrders({
        fs: nodeFileSystem,
        path: join(dataDirectory, "feed-orders.json"),
      }),
      usedPayments: await openUsedPayments({
        fs: nodeFileSystem,
        path: join(dataDirectory, "x402-payments.json"),
        protectedSignatures() {
          const cutoff = Date.now() - UNDELIVERED_RECOVERY_MS;
          return new Set(journal.entries().flatMap((entry) =>
            entry.kind === "research" && entry.signature !== undefined &&
            (entry.status === "reserved" || (entry.status === "settled" && Date.parse(entry.resolvedAt ?? entry.reservedAt) > cutoff))
              ? [entry.signature]
              : []));
        },
        async finalizedHeight() {
          if (!connection || !settings.configured || !isExpectedGenesis(settings.cluster, await connection.getGenesisHash())) return undefined;
          return (await connection.getEpochInfo("finalized")).blockHeight;
        },
      }),
    };
  });
  if (!stores.ok) return { ok: false, issues: [stores.issue] };
  const { decisionLog, purchaseStore, matchStore, chatterStore, journal, usedPayments, feedOrders } = stores.value;
  const publicOrigin = config.value.research.publicOrigin;
  const deferredDeepDive = createDeferredDeepDive(publicOrigin);
  const payments = settings.configured && researchRecipient && connection
    ? createX402Server({
        config: {
          network: x402NetworkFor(settings.cluster),
          mint: settings.mint,
          payTo: researchRecipient,
          priceBaseUnits: priceToBaseUnits(config.value.research.priceCents),
          maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
          mimeType: "application/json",
          resourceFor: (symbol) => deepDiveUrl(publicOrigin, symbol),
        },
        connection,
        used: usedPayments,
        nonces: createNonceCodec({
          secret: config.value.research.paymentSecret ?? randomBytes(SECRET_BYTES).toString("hex"),
          ttlMs: PAYMENT_TIMEOUT_SECONDS * 1000,
          randomHex: () => randomBytes(NONCE_BYTES).toString("hex"),
        }),
        nowMs: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
    : undefined;
  const desk = createDesk({
    policy: config.value.policy,
    feed: config.value.feed,
    markets,
    ledger,
    ledgerView,
    now: () => new Date(),
    idGen: randomUUID,
    history,
    initialLog: decisionLog.initialLog,
    saveLog: decisionLog.saveLog,
    journal,
    feedOrders,
    ...(payments ? { paymentInFlight: payments.paymentInFlight } : {}),
    initialPurchases: purchaseStore.initialPurchases,
    savePurchases: purchaseStore.savePurchases,
    initialMatches: matchStore.initialMatches,
    saveMatches: matchStore.saveMatches,
    ...(researchRecipient
      ? {
          research: {
            recipient: researchRecipient.toBase58(),
            maxPriceCents: config.value.research.priceCents,
            resource: deferredDeepDive.resource,
          },
        }
      : {}),
  });
  const { grok, claude } = config.value.feed;
  const llm = selectLlm({ grok, claude, fetch });
  const xFeedSettings = loadXFeedSettings(env);
  const xFeed = xFeedSettings.bearerToken === undefined
    ? undefined
    : createXFeed({ bearerToken: xFeedSettings.bearerToken, fetch, now: () => new Date() });
  const chatter = xFeed === undefined
    ? undefined
    : createChatter({
        xFeed,
        eventTitle: async (eventTicker) => {
          const result = await markets.getEvent(eventTicker);
          return result.ok ? result.value.title : undefined;
        },
        nowMs: () => Date.now(),
        initialChatter: chatterStore.initialChatter,
        saveChatter: chatterStore.saveChatter,
      });
  const research = createResearch({
    markets,
    history,
    nowMs: () => Date.now(),
    postContextFor: desk.postContextFor,
    matchedPostsFor: desk.matchedPostsFor,
    ...(chatter ? { chatterFor: chatter.peek } : {}),
    ...(llm ? { llm } : {}),
  });
  const deepDive = payments ? createDeepDiveResource({ payments, research, publicOrigin }) : undefined;
  deferredDeepDive.bind(deepDive);
  const reconcile = async () => {
    await Promise.allSettled([desk.reconcile(), payments?.reconcile()]);
  };
  await reconcile();
  const runtime = holder[deskKey];
  if (runtime) runtime.reconciliationTimer ??= startReconciliation(reconcile);
  createSampler({ history, markets, nowMs: () => Date.now() }).start();
  const catalogDeps = { markets, history, now: () => new Date(), policy: config.value.policy };
  const agentStore = openAgentStore({ fs: nodeFileSystem, path: join(dataDirectory, "agents.json") });
  const agentDeps = {
    store: agentStore,
    markets,
    history,
    desk,
    grok,
    claude,
    fetch,
    operatorId: config.value.feed.operatorId,
    ...(xFeed === undefined ? {} : { xFeed }),
  };
  homeCatalog = {
    list: async (query = {}) => {
      const cached = listCache.get(query);
      if (cached) return cached;
      const result = await listCache.takeInFlight(query, () => listCatalog(catalogDeps, query));
      if (result.ok) return result;
      const stale = listCache.getStale(query);
      if (stale?.ok) return { ok: true, page: { ...stale.page, stale: true } };
      return result;
    },
    sparklines: (symbols) => sparklineUpdates(catalogDeps, symbols),

    browse: async (query = {}) => {
      const cached = browseCache.get(query);
      if (cached) return cached;
      const result = await browseCache.takeInFlight(query, () => listBrowse({ markets, history, now: () => new Date() }, query));
      if (result.ok) return result;
      const stale = browseCache.getStale(query);
      if (stale?.ok) return { ok: true, page: { ...stale.page, stale: true } };
      return result;
    },
    spots: (assets) => loadSpotPrices({ markets }, assets),
    cardsFor: (symbols) => cardsForSymbols(catalogDeps, symbols),
    cardsForSaved: (items) => cardsForSaved(catalogDeps, items),
    watchlist: openWatchlist({ fs: nodeFileSystem, path: join(dataDirectory, "watchlist.json") }),
    agents: { store: agentStore, run: agentCycle(agentDeps) },
  };
  const watchlist = homeCatalog.watchlist;
  if (runtime) runtime.agentTimer ??= startAgentLoop(agentDeps);
  const marketPro = createMarketPro({
    markets,
    nowMs: () => Date.now(),
    desk,
    isWatched: async (symbol) => (await watchlist.list()).includes(symbol),
    ...(chatter ? { chatterFor: chatter.peek } : {}),
  });
  if (runtime) runtime.catalog = homeCatalog;
  return { ok: true, desk, research, deepDive, marketPro, chatter };
}

const deskKey: unique symbol = Symbol.for("news-to-trade-desk.desk");
interface DeskRuntime {
  readonly access: Promise<DeskAccess>;
  catalog?: HomeCatalog;
  reconciliationTimer?: ReturnType<typeof startReconciliation>;
  agentTimer?: ReturnType<typeof startAgentLoop>;
}

const holder = globalThis as typeof globalThis & { [deskKey]?: DeskRuntime };

export async function getHomeServices(): Promise<HomeServices> {
  const access = await getDesk();
  if (!access.ok) return access;
  const catalog = holder[deskKey]?.catalog ?? homeCatalog;
  if (catalog === undefined) return { ok: false, issues: ["catalog: unavailable"] };
  return { ok: true, desk: access.desk, research: access.research, catalog, marketPro: access.marketPro };
}

export function getDesk(): Promise<DeskAccess> {
  const existing = holder[deskKey];
  if (existing) return existing.access;
  const created = buildDesk(process.env);
  holder[deskKey] = { access: created };
  return created;
}
