import type { ApprovedResearch, ResearchDecision, ResearchSpend } from "@/features/guardrails";
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
import { researchBriefSchema, usdCents } from "@/shared";
import type { DecisionLogEntry, DeepDiveResult, DeepDiveStep, LedgerView, UsdCents } from "@/shared";

const REQUEST_TIMEOUT_MS = 10_000;
const PAYMENT_TIMEOUT_MS = 45_000;
const RESEARCH_SENDER = "research-agent";

export interface DeepDiveSettings {
  readonly recipient: string;
  readonly maxPriceCents: UsdCents;
}

export type SpendOutcome = "paid" | "released" | "held";

export interface SpendAccount {
  readonly decide: (spend: ResearchSpend) => ResearchDecision;
  readonly reserve: (approved: ApprovedResearch) => void;
  readonly settle: (approved: ApprovedResearch, outcome: SpendOutcome) => void;
  readonly remaining: () => UsdCents;
  readonly record: (entry: Omit<DecisionLogEntry, "entryId" | "at">) => DecisionLogEntry;
}

export interface DeepDiveDeps {
  readonly fetch: typeof fetch;
  readonly ledger: UsdcLedger;
  readonly ledgerView: LedgerView;
  readonly settings: DeepDiveSettings | undefined;
  readonly account: SpendAccount;
}

type ConfiguredLedgerView = Extract<LedgerView, { readonly configured: true }>;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function failureResult(
  status: "refused" | "failed",
  trace: readonly DeepDiveStep[],
  failureReason: string,
): DeepDiveResult {
  return { status, alreadyPurchased: false, trace: [...trace], failureReason, brief: null, purchase: null };
}

function requirementProblem(
  requirement: PaymentRequirements,
  expected: { readonly view: ConfiguredLedgerView; readonly settings: DeepDiveSettings; readonly path: string },
): string | undefined {
  const { view, settings, path } = expected;
  const amount = BigInt(requirement.maxAmountRequired);
  if (requirement.network !== x402NetworkFor(view.cluster)) return `The research server wants payment on ${requirement.network}, but this desk pays on ${x402NetworkFor(view.cluster)}.`;
  if (requirement.asset !== view.mint) return "The research server asked for a different token than the desk's USDC.";
  if (requirement.payTo !== settings.recipient) return "The research server asked to be paid at an address the desk doesn't recognise.";
  if (amount === 0n || amount % BASE_UNITS_PER_CENT !== 0n) return "The research price isn't a whole number of cents.";
  if (amount > BigInt(settings.maxPriceCents) * BASE_UNITS_PER_CENT) return `The research server asked for more than the ${usd(settings.maxPriceCents)} the desk will pay.`;
  if (URL.parse(requirement.resource)?.pathname !== path) return "The payment request is for a different resource than the one the desk asked for.";
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
    case "settlement_failed": return "The payment was submitted but could not be confirmed, so the funds stay reserved until it is checked.";
    case "nonce_reused":
    case "signature_reused": return "The research server says this payment was already used.";
    case "expired": return "The payment request expired before it was settled.";
    case "simulation_failed": return "The payment would not go through on Solana, so nothing was sent.";
    default: return `The research server rejected the payment (${code}).`;
  }
}

export async function buyDeepDive(deps: DeepDiveDeps, symbol: string, origin: string): Promise<DeepDiveResult> {
  const { account, ledger, ledgerView, settings } = deps;
  const trace: DeepDiveStep[] = [];
  if (!ledgerView.configured) return failureResult("failed", trace, "The ledger isn't configured, so the desk can't pay for research.");
  if (!settings) return failureResult("failed", trace, "Research payments aren't configured for this desk.");
  const url = new URL(`/api/research/${encodeURIComponent(symbol)}/deep`, origin);

  let first: Response;
  try {
    first = await deps.fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return failureResult("failed", trace, "I couldn't reach the research service.");
  }
  if (first.status !== 402) return failureResult("failed", trace, `The research service didn't ask for payment (${await readError(first)}).`);
  const requirement = await readRequirements(first);
  if (!requirement) return failureResult("failed", trace, "The research service sent a payment request I couldn't read.");
  const problem = requirementProblem(requirement, { view: ledgerView, settings, path: url.pathname });
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
  account.reserve(decision);
  const fail = (outcome: SpendOutcome, reason: string, code: string): DeepDiveResult => {
    account.settle(decision, outcome);
    account.record({ ...base, kind: "execution-failed", code, spokenReason: reason });
    return failureResult("failed", trace, reason);
  };
  trace.push({
    step: "guardrails",
    detail: `Guardrails approved ${usd(notional)}. ${usd(account.remaining())} left in today's budget.`,
    remainingCents: account.remaining(),
  });

  const signed = await ledger.signPayment({ recipient: requirement.payTo, notional, memo: requirement.extra.memo });
  if (!signed.ok) return fail("released", "I couldn't sign the payment, so nothing was spent.", signed.error.code);
  trace.push({ step: "signed", detail: "Signed a USDC transfer with the desk's own wallet.", signature: signed.value.signature });

  let paid: Response;
  try {
    paid = await deps.fetch(url, {
      headers: { accept: "application/json", [PAYMENT_HEADER]: paymentHeaderFor(requirement.network, signed.value.transaction) },
      redirect: "error",
      signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
    });
  } catch {
    return fail("held", "I sent the payment but never heard back, so the funds stay reserved until it is checked.", "payment-unconfirmed");
  }
  if (!paid.ok) {
    const code = await readError(paid);
    return fail(code === "settlement_failed" ? "held" : "released", paymentFailureText(code), code);
  }
  const settlementHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
  const settlement = settlementHeader === null ? undefined : decodeHeader(settlementResponseSchema, settlementHeader);
  if (!settlement || settlement.transaction !== signed.value.signature || settlement.network !== requirement.network || settlement.payer !== ledgerView.authority) {
    return fail("held", "The research server's receipt didn't match my payment, so the funds stay reserved until it is checked.", "receipt-mismatch");
  }
  account.settle(decision, "paid");
  const entry = account.record({
    ...base,
    kind: "approve",
    spokenReason: `Paid ${usd(notional)} for a deep dive on ${symbol}.`,
    signature: signed.value.signature,
    explorerUrl: signed.value.explorerUrl,
  });
  trace.push({ step: "settled", detail: `Payment confirmed on ${requirement.network}.`, signature: signed.value.signature, explorerUrl: signed.value.explorerUrl });

  let body: unknown;
  try {
    body = await paid.json();
  } catch {
    body = undefined;
  }
  const brief = researchBriefSchema.safeParse(body);
  if (!brief.success) return failureResult("failed", trace, "The payment went through but the brief came back unreadable.");
  trace.push({ step: "brief", detail: "Brief delivered." });
  return {
    status: "delivered",
    alreadyPurchased: false,
    trace,
    failureReason: null,
    brief: brief.data,
    purchase: { at: entry.at, signature: signed.value.signature, explorerUrl: signed.value.explorerUrl, costCents: notional },
  };
}
