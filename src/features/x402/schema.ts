import { z } from "zod";

export const X402_VERSION = 1;
export const PAYMENT_HEADER = "X-PAYMENT";
export const PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";
export const USDC_DECIMALS = 6;
export const BASE_UNITS_PER_CENT = 10_000n;

export type X402Network = "solana-devnet" | "solana-localnet";

const network = z.enum(["solana-devnet", "solana-localnet"]);
const baseUnits = z.string().regex(/^\d+$/);

export function x402NetworkFor(cluster: "devnet" | "localnet"): X402Network {
  return cluster === "devnet" ? "solana-devnet" : "solana-localnet";
}

export const paymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network,
  maxAmountRequired: baseUnits,
  asset: z.string().min(1),
  payTo: z.string().min(1),
  resource: z.string().min(1),
  description: z.string(),
  mimeType: z.string(),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.object({ nonce: z.string().min(1), memo: z.string().min(1) }),
});

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string(),
  accepts: z.array(paymentRequirementsSchema).min(1),
});

export const paymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.literal("exact"),
  network,
  payload: z.object({ transaction: z.string().min(1) }),
});

export const settlementResponseSchema = z.object({
  success: z.literal(true),
  transaction: z.string().min(1),
  network,
  payer: z.string().min(1),
});

export type PaymentRequirements = z.output<typeof paymentRequirementsSchema>;
export type PaymentRequired = z.output<typeof paymentRequiredSchema>;
export type PaymentPayload = z.output<typeof paymentPayloadSchema>;
export type SettlementResponse = z.output<typeof settlementResponseSchema>;

export function encodeHeader(value: PaymentPayload | SettlementResponse): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader<S extends z.ZodType>(schema: S, header: string): z.output<S> | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function paymentHeaderFor(network: X402Network, transactionBase64: string): string {
  return encodeHeader({ x402Version: X402_VERSION, scheme: "exact", network, payload: { transaction: transactionBase64 } });
}

export function priceToBaseUnits(cents: number): bigint {
  return BigInt(cents) * BASE_UNITS_PER_CENT;
}

export type PaymentErrorCode =
  | "invalid_header"
  | "wrong_network"
  | "invalid_transaction"
  | "unexpected_instruction"
  | "missing_transfer"
  | "wrong_mint"
  | "wrong_decimals"
  | "wrong_recipient"
  | "wrong_amount"
  | "wrong_payer"
  | "memo_mismatch"
  | "nonce_invalid"
  | "expired"
  | "nonce_reused"
  | "signature_reused"
  | "invalid_signature"
  | "simulation_failed"
  | "store_unavailable"
  | "settlement_failed"
  | "settlement_unconfirmed"
  | "settlement_mismatch"
  | "unknown_payment";
