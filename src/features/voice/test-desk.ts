import { vi } from "vitest";
import { createDesk } from "@/features/desk";
import { createPolicy } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { instrumentSymbol, usdCents } from "@/shared";
import type { VoiceDeps } from "./handlers";

export const OPERATOR_ID = "priscilla";
export const FED_HEADLINE = "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says";

const maintain = instrumentSymbol("GEMI-FED261211-MAINTAIN");
const cut = instrumentSymbol("GEMI-FED261211-CUT25");

function contract(symbol: typeof maintain, label: string): MarketContract {
  return {
    instrumentSymbol: symbol,
    label,
    marketState: "open",
    status: "active",
    prices: { bestBidCents: 60, bestAskCents: 62, lastTradeCents: 62, buyYesCents: 62, buyNoCents: 40 },
    limits: { quantityIncrementHundredths: 1n, quantityMinimumHundredths: 1n, priceIncrementCents: 1n, priceMinimumCents: 1n },
  };
}

const fedEvent: MarketEvent = {
  ticker: "FED261211",
  title: "Fed decision in December?",
  category: "Economics",
  status: "active",
  expiryDate: null,
  tags: ["fed"],
  contracts: [contract(maintain, "Fed maintains rate"), contract(cut, "Cut 25bps")],
};

export function voiceFixture(options: { readonly senders?: readonly string[] } = {}) {
  let receipts = 0;
  const debit = vi.fn<UsdcLedger["debit"]>(() => {
    receipts += 1;
    const signature = `sig-${String(receipts)}`;
    return Promise.resolve({ ok: true, value: { signature, explorerUrl: `https://explorer.test/tx/${signature}` } });
  });
  const markets = {
    searchEvents: vi.fn<GeminiMarketsClient["searchEvents"]>(() => Promise.resolve(ok({ events: [fedEvent], total: 1 }))),
    getEvent: vi.fn<GeminiMarketsClient["getEvent"]>(() => Promise.resolve(ok(fedEvent))),
  };
  const policy = createPolicy({
    dailyCap: usdCents(2000),
    autoApproveMax: usdCents(200),
    perTradeMax: usdCents(1000),
    marketAllowlist: new Set([maintain, cut]),
    marketCategories: new Set(["Economics"]),
    senderAllowlist: new Set(options.senders ?? [OPERATOR_ID]),
    killSwitch: false,
  });
  if (!policy.ok) throw new Error("invalid policy");
  let ids = 0;
  const desk = createDesk({
    policy: policy.value,
    markets,
    feed: { operatorId: "priscilla", grok: { apiKey: undefined, model: "grok-test" } },
    ledger: { debit, balance: vi.fn() },
    ledgerView: { configured: true, cluster: "localnet", authority: "Authority1", mint: "Mint1", recipient: "Recipient1" },
    now: () => new Date("2026-11-17T12:00:00Z"),
    idGen: () => `id-${String(++ids)}`,
  });
  const deps: VoiceDeps = { desk, operatorId: OPERATOR_ID };
  return { desk, deps, debit };
}

export async function fixtureWithMatchedNews(options: Parameters<typeof voiceFixture>[0] = {}) {
  const fixture = voiceFixture(options);
  await fixture.desk.submitNews({ id: "news-1", text: FED_HEADLINE, postedAt: new Date("2026-11-17T11:59:00Z") });
  return fixture;
}
