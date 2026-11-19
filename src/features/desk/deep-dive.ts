import type { ApprovedResearch, ResearchDecision, ResearchSpend } from "@/features/guardrails";
import type { SignedPaymentRef } from "@/features/journal";
import type { UsdcLedger } from "@/features/ledger";
import {
  BASE_UNITS_PER_CENT,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  decodeHeader,
  paymentHeaderFor,
  paymentRequiredSchema,
  settlementResponseSchema,
  x402NetworkFor,
} from "@/features/x402";
import type { PaymentRequirements } from "@/features/x402";
import type { DeepDiveResource } from "./deep-dive-resource";
import { researchBriefSchema, usdCents } from "@/shared";
import type { DecisionLogEntry, DeepDiveResult, DeepDiveStep, LedgerView, UsdCents } from "@/shared";

const REQUEST_TIMEOUT_MS = 10_000;
const PAYMENT_TIMEOUT_MS = 45_000;
const RESEARCH_SENDER = "research-agent";

export interface DeepDiveSettings {
  readonly recipient: string;
  readonly maxPriceCents: UsdCents;
  readonly resource: DeepDiveResource;
}

export interface SpendAccount {
  readonly decide: (spend: ResearchSpend) => ResearchDecision;
  readonly begin: (approved: ApprovedResearch, symbol: string) => Promise<boolean>;
  readonly signed: (approved: ApprovedResearch, payment: SignedPaymentRef) => Promise<boolean>;
  readonly resolve: (approved: ApprovedResearch, outcome: "settled" | "failed") => Promise<void>;
  readonly remaining: () => UsdCents;
  readonly record: (entry: Omit<DecisionLogEntry, "entryId" | "at">) => DecisionLogEntry;
}

export interface DeepDiveDeps {
  readonly ledger: UsdcLedger;
  readonly ledgerView: LedgerView;
  readonly settings: DeepDiveSettings | undefined;
  readonly account: SpendAccount;
}

type ConfiguredLedgerView = Extract<LedgerView, { readonly configured: true }>;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const NOT_BROADCAST_CODES: ReadonlySet<string> = new Set([
  "invalid_header",
  "wrong_network",
  "invalid_transaction",
  "unexpected_instruction",
  "missing_transfer",
  "wrong_mint",
  "wrong_decimals",
  "wrong_recipient",
  "wrong_amount",
  "wrong_payer",
  "memo_mismatch",
  "nonce_invalid",
  "expired",
  "invalid_signature",
  "simulation_failed",
  "store_unavailable",
  "settlement_failed",
  "unknown-symbol",
  "gemini-unavailable",
]);

function failureResult(
  status: "refused" | "failed",
  trace: readonly DeepDiveStep[],
  failureReason: string,
  purchase: DeepDiveResult["purchase"] = null,
): DeepDiveResult {
  return { status, alreadyPurchased: false, trace: [...trace], failureReason, brief: null, purchase };
}

function withinTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("request failed"));
      },
    );
  });
}

function requirementProblem(
  requirement: PaymentRequirements,
  expected: { readonly view: ConfiguredLedgerView; readonly settings: DeepDiveSettings; readonly url: string },
): string | undefined {
  const { view, settings, url } = expected;
  const amount = BigInt(requirement.maxAmountRequired);
  if (requirement.network !== x402NetworkFor(view.cluster)) return `The research server wants payment on ${requirement.network}, but this desk pays on ${x402NetworkFor(view.cluster)}.`;
  if (requirement.asset !== view.mint) return "The research server asked for a different token than the desk's USDC.";
  if (requirement.payTo !== settings.recipient) return "The research server asked to be paid at an address the desk doesn't recognise.";
  if (amount === 0n || amount % BASE_UNITS_PER_CENT !== 0n) return "The research price isn't a whole number of cents.";
  if (amount > BigInt(settings.maxPriceCents) * BASE_UNITS_PER_CENT) return `The research server asked for more than the ${usd(settings.maxPriceCents)} the desk will pay.`;
  if (requirement.resource !== url) return "The payment request is for a different resource than the one the desk asked for.";
  return undefined;
}

async function readRequirements(response: Response): Promise<PaymentRequirements | undefined> {
  try {
    const parsed = paymentRequiredSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.accepts[0] : undefined;
  } catch {
    return undefined;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = paymentRequiredSchema.safeParse(body);
    if (parsed.success) return parsed.data.error;
    return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `http_${String(response.status)}`;
  } catch {
    return `http_${String(response.status)}`;
  }
}

function paymentFailureText(code: string): string {
  switch (code) {
    case "settlement_failed": return "The payment was submitted but did not land on Solana, so nothing was spent.";
    case "settlement_unconfirmed":
    case "settlement_mismatch": return "The payment was submitted but could not be confirmed, so the funds stay reserved until it is checked.";
    case "nonce_reused":
    case "signature_reused": return "The research server says this payment was already used, so the funds stay reserved until it is checked.";
    case "expired": return "The payment request expired before it was settled.";
    case "simulation_failed": return "The payment would not go through on Solana, so nothing was sent.";
    default: return `The research server rejected the payment (${code}).`;
  }
}

export async function buyDeepDive(deps: DeepDiveDeps, symbol: string): Promise<DeepDiveResult> {
  const { account, ledger, ledgerView, settings } = deps;
  const trace: DeepDiveStep[] = [];
  if (!ledgerView.configured) return failureResult("failed", trace, "The ledger isn't configured, so the desk can't pay for research.");
  if (!settings) return failureResult("failed", trace, "Research payments aren't configured for this desk.");
  const { resource } = settings;
  const url = resource.urlFor(symbol);
  const ask = (headers: Record<string, string>, timeoutMs: number) =>
    withinTimeout(resource.handle(new Request(url, { headers: { accept: "application/json", ...headers } }), symbol), timeoutMs);

  let first: Response;
  try {
    first = await ask({}, REQUEST_TIMEOUT_MS);
  } catch {
    return failureResult("failed", trace, "I couldn't reach the research service.");
  }
  if (first.status !== 402) return failureResult("failed", trace, `The research service didn't ask for payment (${await readError(first)}).`);
  const requirement = await readRequirements(first);
  if (!requirement) return failureResult("failed", trace, "The research service sent a payment request I couldn't read.");
  const problem = requirementProblem(requirement, { view: ledgerView, settings, url });
  if (problem) return failureResult("failed", trace, problem);
  const notional = usdCents(Number(BigInt(requirement.maxAmountRequired) / BASE_UNITS_PER_CENT));
  trace.push({
    step: "requirements",
    detail: `x402 payment request: ${usd(notional)} USDC on ${requirement.network}, payable to ${requirement.payTo}.`,
  });

  const spend: ResearchSpend = { spendId: `research:${requirement.extra.nonce}`, notional };
  const base = { intentId: spend.spendId, symbol, outcome: null, notionalCents: notional, senderId: RESEARCH_SENDER, source: "research" } as const;
  const decision = account.decide(spend);
  if (decision.kind === "refuse") {
    account.record({ ...base, kind: "refuse", code: decision.code, spokenReason: decision.spokenReason });
    return failureResult("refused", trace, decision.spokenReason);
  }
  const reserved = await account.begin(decision, symbol);
  const stop = async (outcome: "released" | "held", reason: string, code: string): Promise<DeepDiveResult> => {
    if (outcome === "released") await account.resolve(decision, "failed");
    account.record({ ...base, kind: "execution-failed", code, spokenReason: reason });
    return failureResult("failed", trace, reason);
  };
  if (!reserved) return stop("released", "I couldn't record the payment safely, so nothing was spent.", "journal-unavailable");
  trace.push({
    step: "guardrails",
    detail: `Guardrails approved ${usd(notional)}. ${usd(account.remaining())} left in today's budget.`,
    remainingCents: account.remaining(),
  });

  const signed = await ledger.signPayment({ recipient: requirement.payTo, notional, memo: requirement.extra.memo });
  if (!signed.ok) return stop("released", "I couldn't sign the payment, so nothing was spent.", signed.error.code);
  const recorded = await account.signed(decision, { signature: signed.value.signature, blockhash: signed.value.blockhash, explorerUrl: signed.value.explorerUrl });
  if (!recorded) return stop("released", "I couldn't record the signed payment safely, so I did not send it.", "journal-unavailable");
  trace.push({ step: "signed", detail: "Signed a USDC transfer with the desk's own wallet.", signature: signed.value.signature });

  let paid: Response;
  try {
    paid = await ask({ [PAYMENT_HEADER]: paymentHeaderFor(requirement.network, signed.value.transaction) }, PAYMENT_TIMEOUT_MS);
  } catch {
    return stop("held", "I sent the payment but never heard back, so the funds stay reserved until it is checked.", "payment-unconfirmed");
  }
  if (!paid.ok) {
    const code = await readError(paid);
    return stop(NOT_BROADCAST_CODES.has(code) ? "released" : "held", paymentFailureText(code), code);
  }
  const settlementHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
  const settlement = settlementHeader === null ? undefined : decodeHeader(settlementResponseSchema, settlementHeader);
  if (!settlement || settlement.transaction !== signed.value.signature || settlement.network !== requirement.network || settlement.payer !== ledgerView.authority) {
    return stop("held", "The research server's receipt didn't match my payment, so the funds stay reserved until it is checked.", "receipt-mismatch");
  }
  await account.resolve(decision, "settled");
  const entry = account.record({
    ...base,
    kind: "approve",
    spokenReason: `Paid ${usd(notional)} for a deep dive on ${symbol}.`,
    signature: signed.value.signature,
    explorerUrl: signed.value.explorerUrl,
  });
  trace.push({ step: "settled", detail: `Payment confirmed on ${requirement.network}.`, signature: signed.value.signature, explorerUrl: signed.value.explorerUrl });
  const purchase = { at: entry.at, signature: signed.value.signature, explorerUrl: signed.value.explorerUrl, costCents: notional };

  let body: unknown;
  try {
    body = await paid.json();
  } catch {
    body = undefined;
  }
  const brief = researchBriefSchema.safeParse(body);
  if (!brief.success) {
    return failureResult("failed", trace, "The payment went through but the brief came back unreadable. Try again and I will fetch it without paying twice.", purchase);
  }
  trace.push({ step: "brief", detail: "Brief delivered." });
  return { status: "delivered", alreadyPurchased: false, trace, failureReason: null, brief: brief.data, purchase };
}
