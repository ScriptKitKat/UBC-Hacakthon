import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { loadGrokSettings } from "@/features/grok";
import type { GrokSettings } from "@/features/grok";
import { loadClaudeSettings } from "@/features/claude";
import type { ClaudeSettings } from "@/features/claude";
import { DEFAULT_MARKET_CATEGORIES, createPolicy } from "@/features/guardrails";
import type { Policy } from "@/features/guardrails";
import { instrumentSymbol, usdCents } from "@/shared";
import type { UsdCents } from "@/shared";

const dollarAmount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "must be a dollar amount with at most two decimals")
  .transform((text) => usdCents(Math.round(Number(text) * 100)));

const commaList = z
  .string()
  .transform((text) => text.split(",").map((item) => item.trim()).filter((item) => item.length > 0))
  .pipe(z.array(z.string()).min(1, "must list at least one value"));

const publicKey = z.string().trim().transform((text, context) => {
  try {
    return new PublicKey(text);
  } catch {
    context.addIssue({ code: "custom", message: "must be a base58 public key" });
    return z.NEVER;
  }
});

const envSchema = z.object({
  DAILY_CAP_USD: dollarAmount,
  AUTO_APPROVE_MAX_USD: dollarAmount,
  PER_TRADE_MAX_USD: dollarAmount.default(usdCents(1000)),
  MARKET_ALLOWLIST: commaList.optional(),
  MARKET_CATEGORIES: commaList.default([...DEFAULT_MARKET_CATEGORIES]),
  FEED_OPERATOR_ID: z.string().trim().min(1).optional(),
  SENDER_ALLOWLIST: commaList,
  GEMINI_API_BASE: z.url().default("https://api.gemini.com"),
  SOLANA_CLUSTER: z.enum(["devnet", "localnet"]).optional(),
  SOLANA_RPC_URL: z.url().optional(),
  SOLANA_KEYPAIR_PATH: z.string().min(1).optional(),
  VAULT_RECIPIENT: publicKey.optional(),
  USDC_MINT: publicKey.optional(),
  RESEARCH_RECIPIENT: publicKey.optional(),
  RESEARCH_PRICE_USD: dollarAmount.default(usdCents(5)),
  RESEARCH_PAYMENT_SECRET: z.string().min(16).optional(),
  DESK_PUBLIC_ORIGIN: z.url().transform((text) => new URL(text).origin).default("http://localhost:3000"),
  SOLANA_TEST_MINT: publicKey.optional(),
});

export type LedgerSettings =
  | {
      readonly configured: true;
      readonly cluster: "localnet" | "devnet";
      readonly rpcUrl: string;
      readonly keypairPath: string;
      readonly recipient: PublicKey;
      readonly mint: PublicKey;
      readonly testMint?: PublicKey;
    }
  | { readonly configured: false; readonly missing: readonly string[] };

export interface FeedSettings {
  readonly operatorId: string;
  readonly grok: GrokSettings;
  readonly claude: ClaudeSettings;
}

export interface ResearchSettings {
  readonly recipient: PublicKey | undefined;
  readonly priceCents: UsdCents;
  readonly paymentSecret: string | undefined;
  readonly publicOrigin: string;
}

export interface DeskConfig {
  readonly policy: Policy;
  readonly research: ResearchSettings;
  readonly feed: FeedSettings;
  readonly geminiBaseUrl: string;
  readonly ledger: LedgerSettings;
}

export type DeskConfigResult =
  | { readonly ok: true; readonly value: DeskConfig }
  | { readonly ok: false; readonly issues: readonly string[] };

function ledgerSettings(env: z.output<typeof envSchema>): LedgerSettings {
  const { SOLANA_CLUSTER: cluster, SOLANA_RPC_URL: rpcUrl, SOLANA_KEYPAIR_PATH: keypairPath, VAULT_RECIPIENT: recipient, USDC_MINT: mint } = env;
  const missing = [
    ["SOLANA_CLUSTER", cluster],
    ["SOLANA_RPC_URL", rpcUrl],
    ["SOLANA_KEYPAIR_PATH", keypairPath],
    ["VAULT_RECIPIENT", recipient],
    ["USDC_MINT", mint],
  ].flatMap(([name, value]) => (value === undefined ? [String(name)] : []));
  if (!cluster || !rpcUrl || !keypairPath || !recipient || !mint) return { configured: false, missing };
  const testMint = env.SOLANA_TEST_MINT ?? (cluster === "localnet" ? mint : undefined);
  return { configured: true, cluster, rpcUrl, keypairPath, recipient, mint, ...(testMint ? { testMint } : {}) };
}

export function loadDeskConfig(env: Readonly<Record<string, string | undefined>>): DeskConfigResult {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const values = parsed.data;
  const policy = createPolicy({
    dailyCap: values.DAILY_CAP_USD,
    autoApproveMax: values.AUTO_APPROVE_MAX_USD,
    perTradeMax: values.PER_TRADE_MAX_USD,
    marketAllowlist: new Set((values.MARKET_ALLOWLIST ?? []).map(instrumentSymbol)),
    marketCategories: new Set(values.MARKET_CATEGORIES),
    senderAllowlist: new Set(values.SENDER_ALLOWLIST),
    killSwitch: false,
  });
  if (!policy.ok) {
    return { ok: false, issues: ["AUTO_APPROVE_MAX_USD <= PER_TRADE_MAX_USD <= DAILY_CAP_USD must hold"] };
  }
  const operatorId = values.FEED_OPERATOR_ID ?? values.SENDER_ALLOWLIST[0];
  if (operatorId === undefined) return { ok: false, issues: ["SENDER_ALLOWLIST: must list at least one value"] };
  const feed: FeedSettings = { operatorId, grok: loadGrokSettings(present), claude: loadClaudeSettings(present) };
  const research: ResearchSettings = {
    recipient: values.RESEARCH_RECIPIENT ?? values.VAULT_RECIPIENT,
    priceCents: values.RESEARCH_PRICE_USD,
    paymentSecret: values.RESEARCH_PAYMENT_SECRET,
    publicOrigin: values.DESK_PUBLIC_ORIGIN,
  };
  return { ok: true, value: { policy: policy.value, research, feed, geminiBaseUrl: values.GEMINI_API_BASE, ledger: ledgerSettings(values) } };
}
