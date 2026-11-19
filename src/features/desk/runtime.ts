import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createSampler, openHistoryStore } from "@/features/history";
import { createSolanaLedger, createUnconfiguredLedger } from "@/features/ledger";
import type { UsdcLedger } from "@/features/ledger";
import { createGeminiMarketsClient } from "@/features/markets";
import { createResearch } from "@/features/research";
import type { Research } from "@/features/research";
import { nodeFileSystem, resolveDataDirectory } from "@/features/storage";
import type { LedgerView } from "@/shared";
import { loadDeskConfig } from "./config";
import { createDesk } from "./desk";
import type { Desk } from "./desk";
import { openDecisionLog } from "./log-store";

const GEMINI_MIN_REQUEST_INTERVAL_MS = 500;

export type DeskAccess =
  | { readonly ok: true; readonly desk: Desk; readonly research: Research }
  | { readonly ok: false; readonly issues: readonly string[] };

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
  const markets = createGeminiMarketsClient({ baseUrl: config.value.geminiBaseUrl, fetch, minRequestIntervalMs: GEMINI_MIN_REQUEST_INTERVAL_MS });
  const dataDirectory = resolveDataDirectory(env, process.cwd());
  const history = await openHistoryStore({ fs: nodeFileSystem, path: join(dataDirectory, "price-history.json") });
  const decisionLog = await openDecisionLog({ fs: nodeFileSystem, path: join(dataDirectory, "decision-log.json") });
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
  });
  const research = createResearch({ markets, history, nowMs: () => Date.now(), postContextFor: desk.postContextFor });
  createSampler({ history, markets, nowMs: () => Date.now() }).start();
  return { ok: true, desk, research };
}

const deskKey: unique symbol = Symbol.for("news-to-trade-desk.desk");
const holder = globalThis as typeof globalThis & { [deskKey]?: Promise<DeskAccess> };

export function getDesk(): Promise<DeskAccess> {
  const existing = holder[deskKey];
  if (existing) return existing;
  const created = buildDesk(process.env);
  holder[deskKey] = created;
  return created;
}
