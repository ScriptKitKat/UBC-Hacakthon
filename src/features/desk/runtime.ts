import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { requestGrokJson } from "@/features/grok";
import { createSampler, openHistoryStore } from "@/features/history";
import { createSolanaLedger, createUnconfiguredLedger, isExpectedGenesis } from "@/features/ledger";
import type { UsdcLedger } from "@/features/ledger";
import { cardsForSymbols, listCatalog, openWatchlist } from "@/features/catalog";
import type { CatalogListResult, CatalogQuery, Watchlist } from "@/features/catalog";
import type { CatalogCard } from "@/shared";
import { createGeminiMarketsClient } from "@/features/markets";
import { createResearch } from "@/features/research";
import type { JsonCompleter, Research } from "@/features/research";
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
import { UNDELIVERED_RECOVERY_MS, openPurchaseStore } from "./purchase-store";

const GEMINI_MIN_REQUEST_INTERVAL_MS = 500;
const PAYMENT_TIMEOUT_SECONDS = 120;
let homeCatalog: HomeCatalog | undefined;
const NONCE_BYTES = 16;
const SECRET_BYTES = 32;

export type DeskAccess =
  | { readonly ok: true; readonly desk: Desk; readonly research: Research; readonly deepDive: DeepDiveResource | undefined }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface HomeCatalog {
  readonly list: (query?: CatalogQuery) => Promise<CatalogListResult>;
  readonly cardsFor: (symbols: readonly string[]) => Promise<readonly CatalogCard[]>;
  readonly watchlist: Watchlist;
}

export type HomeServices =
  | { readonly ok: true; readonly desk: Desk; readonly research: Research; readonly catalog: HomeCatalog }
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
  const markets = createGeminiMarketsClient({ baseUrl: config.value.geminiBaseUrl, fetch, minRequestIntervalMs: GEMINI_MIN_REQUEST_INTERVAL_MS });
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
  const { decisionLog, purchaseStore, journal, usedPayments, feedOrders } = stores.value;
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
  const grok = config.value.feed.grok;
  const completeJson: JsonCompleter | undefined = grok.apiKey === undefined
    ? undefined
    : (request) => requestGrokJson({ settings: grok, fetch, ...request });
  const research = createResearch({ markets, history, nowMs: () => Date.now(), postContextFor: desk.postContextFor, ...(completeJson ? { completeJson } : {}) });
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
  homeCatalog = {
    list: (query) => listCatalog(catalogDeps, query),
    cardsFor: (symbols) => cardsForSymbols(catalogDeps, symbols),
    watchlist: openWatchlist({ fs: nodeFileSystem, path: join(dataDirectory, "watchlist.json") }),
  };
  if (runtime) runtime.catalog = homeCatalog;
  return { ok: true, desk, research, deepDive };
}

const deskKey: unique symbol = Symbol.for("news-to-trade-desk.desk");
interface DeskRuntime {
  readonly access: Promise<DeskAccess>;
  catalog?: HomeCatalog;
  reconciliationTimer?: ReturnType<typeof startReconciliation>;
}

const holder = globalThis as typeof globalThis & { [deskKey]?: DeskRuntime };

export async function getHomeServices(): Promise<HomeServices> {
  const access = await getDesk();
  if (!access.ok) return access;
  const catalog = holder[deskKey]?.catalog ?? homeCatalog;
  if (catalog === undefined) return { ok: false, issues: ["catalog: unavailable"] };
  return { ok: true, desk: access.desk, research: access.research, catalog };
}

export function getDesk(): Promise<DeskAccess> {
  const existing = holder[deskKey];
  if (existing) return existing.access;
  const created = buildDesk(process.env);
  holder[deskKey] = { access: created };
  return created;
}
