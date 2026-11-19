import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { VersionedTransaction } from "@solana/web3.js";
import type { Connection, PublicKey } from "@solana/web3.js";
import { checkPaymentLanding, inspectTokenDestination, isExpectedGenesis } from "@/features/ledger";
import type { SignatureOutcome } from "@/features/ledger";
import { inspectPayment } from "./inspect";
import type { InspectedPayment } from "./inspect";
import { paymentMemo, parsePaymentMemo } from "./nonce";
import type { NonceCodec, PaymentTerms } from "./nonce";
import { X402_VERSION, decodeHeader, paymentPayloadSchema } from "./schema";
import type { PaymentErrorCode, PaymentRequired, X402Network } from "./schema";
import type { UsedPayments } from "./store";

const CONFIRM_COMMITMENT = "confirmed";
const LANDING_POLL_ATTEMPTS = 80;
const LANDING_POLL_MS = 500;
const PARSED_TRANSACTION_ATTEMPTS = 5;
const PARSED_TRANSACTION_RETRY_MS = 300;

export type SettlementConnection = Pick<
  Connection,
  "getAccountInfo" | "getGenesisHash" | "getEpochInfo" | "getLatestBlockhash" | "getParsedTransaction" | "getSignatureStatuses" | "sendRawTransaction" | "simulateTransaction"
>;

export interface X402ServerConfig {
  readonly network: X402Network;
  readonly mint: PublicKey;
  readonly payTo: PublicKey;
  readonly priceBaseUnits: bigint;
  readonly maxTimeoutSeconds: number;
  readonly mimeType: string;
  readonly resourceFor: (symbol: string) => string;
}

export interface X402ServerDeps {
  readonly config: X402ServerConfig;
  readonly connection: SettlementConnection;
  readonly used: UsedPayments;
  readonly nonces: NonceCodec;
  readonly nowMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

type Result<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: PaymentErrorCode };

export interface VerifiedPayment {
  readonly symbol: string;
  readonly nonce: string;
  readonly payment: InspectedPayment;
  readonly simulationSlot: number;
}

export interface Settlement {
  readonly signature: string;
  readonly payer: string;
  readonly network: X402Network;
}

export interface X402Server {
  readonly requirements: (symbol: string, description: string, error: string) => PaymentRequired;
  readonly verify: (paymentHeader: string, symbol: string) => Promise<Result<VerifiedPayment>>;
  readonly settle: (verified: VerifiedPayment) => Promise<Result<Settlement>>;
  readonly recover: (symbol: string, signature: string) => Promise<Result<Settlement>>;
}

const fail = (error: PaymentErrorCode): { readonly ok: false; readonly error: PaymentErrorCode } => ({ ok: false, error });

export function createX402Server(deps: X402ServerDeps): X402Server {
  const { config, connection, used, nonces, nowMs, sleep } = deps;
  const destination = getAssociatedTokenAddressSync(config.mint, config.payTo);
  const expected = { mint: config.mint, destination, amount: config.priceBaseUnits };
  let networkVerified = false;

  async function onExpectedNetwork(): Promise<boolean> {
    if (networkVerified) return true;
    try {
      const cluster = config.network === "solana-devnet" ? "devnet" : "localnet";
      networkVerified = isExpectedGenesis(cluster, await connection.getGenesisHash());
    } catch {
      return false;
    }
    return networkVerified;
  }

  function termsFor(symbol: string): PaymentTerms {
    return {
      symbol,
      resource: config.resourceFor(symbol),
      amount: config.priceBaseUnits.toString(),
      asset: config.mint.toBase58(),
      payTo: config.payTo.toBase58(),
      network: config.network,
    };
  }

  async function destinationIsPayee(): Promise<boolean> {
    try {
      return await inspectTokenDestination(connection, destination, { mint: config.mint, owner: config.payTo }) === "ok";
    } catch {
      return false;
    }
  }

  async function awaitLanding(signature: string, lastValidBlockHeight: number | undefined): Promise<SignatureOutcome> {
    for (let attempt = 0; attempt < LANDING_POLL_ATTEMPTS; attempt += 1) {
      const outcome = await checkPaymentLanding(connection, { signature, lastValidBlockHeight });
      if (outcome !== "pending") return outcome;
      await sleep(LANDING_POLL_MS);
    }
    return "pending";
  }

  async function paidAmountMatches(signature: string): Promise<boolean> {
    for (let attempt = 0; attempt < PARSED_TRANSACTION_ATTEMPTS; attempt += 1) {
      const parsed = await connection.getParsedTransaction(signature, { commitment: CONFIRM_COMMITMENT, maxSupportedTransactionVersion: 0 });
      const meta = parsed?.meta;
      if (meta) {
        if (meta.err !== null) return false;
        const balanceOf = (balances: typeof meta.preTokenBalances) => balances
          ?.filter((balance) => balance.mint === config.mint.toBase58() && balance.owner === config.payTo.toBase58())
          .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n) ?? 0n;
        return balanceOf(meta.postTokenBalances) - balanceOf(meta.preTokenBalances) === config.priceBaseUnits;
      }
      await sleep(PARSED_TRANSACTION_RETRY_MS);
    }
    return false;
  }

  return {
    requirements(symbol, description, error) {
      const terms = termsFor(symbol);
      const nonce = nonces.issue(terms, nowMs());
      return {
        x402Version: X402_VERSION,
        error,
        accepts: [
          {
            scheme: "exact",
            network: config.network,
            maxAmountRequired: config.priceBaseUnits.toString(),
            asset: config.mint.toBase58(),
            payTo: config.payTo.toBase58(),
            resource: terms.resource,
            description,
            mimeType: config.mimeType,
            maxTimeoutSeconds: config.maxTimeoutSeconds,
            extra: { nonce, memo: paymentMemo(symbol, nonce) },
          },
        ],
      };
    },

    async verify(paymentHeader, symbol) {
      const payload = decodeHeader(paymentPayloadSchema, paymentHeader);
      if (!payload) return fail("invalid_header");
      if (payload.network !== config.network) return fail("wrong_network");
      const inspected = inspectPayment(payload.payload.transaction, expected);
      if (!inspected.ok) return inspected;
      const memo = parsePaymentMemo(inspected.value.memo);
      if (!memo || memo.symbol !== symbol) return fail("memo_mismatch");
      const nonceCheck = nonces.check(memo.nonce, termsFor(symbol), nowMs());
      if (nonceCheck !== "ok") return fail(nonceCheck);
      const reused = used.reuse(memo.nonce, inspected.value.signature);
      if (reused) return fail(reused);
      if (!await onExpectedNetwork()) return fail("wrong_network");
      try {
        const simulation = await connection.simulateTransaction(VersionedTransaction.deserialize(inspected.value.rawTransaction), { sigVerify: true, commitment: CONFIRM_COMMITMENT });
        if (simulation.value.err !== null) return fail("simulation_failed");
        return { ok: true, value: { symbol, nonce: memo.nonce, payment: inspected.value, simulationSlot: simulation.context.slot } };
      } catch {
        return fail("simulation_failed");
      }
    },

    async settle({ symbol, nonce, payment, simulationSlot }) {
      const expiry = nonces.check(nonce, termsFor(symbol), nowMs());
      if (expiry !== "ok") return fail(expiry);
      if (!await destinationIsPayee()) return fail("wrong_recipient");
      try {
        const latest = await connection.getLatestBlockhash({ commitment: CONFIRM_COMMITMENT, minContextSlot: simulationSlot }).catch(() => undefined);
        const lastValidBlockHeight = latest && latest.blockhash === payment.blockhash ? latest.lastValidBlockHeight : undefined;
        const claimError = await used.claim({ nonce, signature: payment.signature, atMs: nowMs(), symbol, payer: payment.payer, lastValidBlockHeight });
        if (claimError) return fail(claimError);
        const signature = await connection.sendRawTransaction(payment.rawTransaction, { preflightCommitment: CONFIRM_COMMITMENT });
        if (signature !== payment.signature) return fail("settlement_unconfirmed");
        const landing = await awaitLanding(signature, lastValidBlockHeight);
        if (landing === "failed") return fail("settlement_failed");
        if (landing === "pending") return fail("settlement_unconfirmed");
        if (!await paidAmountMatches(signature)) return fail("settlement_mismatch");
        await used.markSettled(signature);
        return { ok: true, value: { signature, payer: payment.payer, network: config.network } };
      } catch {
        return fail("settlement_unconfirmed");
      }
    },

    async recover(symbol, signature) {
      const record = used.find(signature);
      if (record?.symbol !== symbol) return fail("unknown_payment");
      const settlement = { signature, payer: record.payer, network: config.network };
      if (record.status === "settled") return { ok: true, value: settlement };
      try {
        const landing = await checkPaymentLanding(connection, { signature, lastValidBlockHeight: record.lastValidBlockHeight });
        if (landing === "failed") return fail("settlement_failed");
        if (landing === "pending" || !await paidAmountMatches(signature)) return fail("settlement_unconfirmed");
        await used.markSettled(signature);
        return { ok: true, value: settlement };
      } catch {
        return fail("settlement_unconfirmed");
      }
    },
  };
}
