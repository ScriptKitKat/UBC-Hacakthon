import { randomUUID } from "node:crypto";
import { createSolanaLedger, createUnconfiguredLedger } from "@/features/ledger";
import type { UsdcLedger } from "@/features/ledger";
import { createGeminiMarketsClient } from "@/features/markets";
import type { LedgerView } from "@/shared";
import { loadDeskConfig } from "./config";
import { createDesk } from "./desk";
import type { Desk } from "./desk";

export type DeskAccess =
  | { readonly ok: true; readonly desk: Desk }
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
  const markets = createGeminiMarketsClient({ baseUrl: config.value.geminiBaseUrl, fetch });
  return { ok: true, desk: createDesk({ policy: config.value.policy, markets, ledger, ledgerView, now: () => new Date(), idGen: randomUUID }) };
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
