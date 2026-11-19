import { z } from "zod";
import { createJsonStore, createSerialQueue } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import type { PaymentErrorCode } from "./schema";

const RETENTION_MS = 24 * 60 * 60 * 1000;

const recordSchema = z.object({
  nonce: z.string(),
  signature: z.string(),
  atMs: z.number(),
  symbol: z.string().default(""),
  payer: z.string().default(""),
  status: z.enum(["claimed", "settled"]).default("claimed"),
});
const fileSchema = z.object({ version: z.literal(1), records: z.array(recordSchema) });

export type UsedPayment = z.output<typeof recordSchema>;
export type NewUsedPayment = Pick<UsedPayment, "nonce" | "signature" | "atMs" | "symbol" | "payer">;

export type ReuseError = Extract<PaymentErrorCode, "nonce_reused" | "signature_reused" | "store_unavailable">;

export interface UsedPayments {
  readonly reuse: (nonce: string, signature: string) => ReuseError | undefined;
  readonly claim: (payment: NewUsedPayment) => Promise<ReuseError | undefined>;
  readonly markSettled: (signature: string) => Promise<void>;
  readonly find: (signature: string) => UsedPayment | undefined;
}

export function createUsedPayments(initial: readonly UsedPayment[], persist: (records: readonly UsedPayment[]) => Promise<void>): UsedPayments {
  let records: readonly UsedPayment[] = [...initial];
  const queue = createSerialQueue();

  function reuse(nonce: string, signature: string): ReuseError | undefined {
    if (records.some((record) => record.nonce === nonce)) return "nonce_reused";
    if (records.some((record) => record.signature === signature)) return "signature_reused";
    return undefined;
  }

  return {
    reuse,
    claim: (payment) =>
      queue.run(async () => {
        const already = reuse(payment.nonce, payment.signature);
        if (already) return already;
        const next = [...records.filter((record) => payment.atMs - record.atMs < RETENTION_MS), { ...payment, status: "claimed" as const }];
        try {
          await persist(next);
        } catch {
          return "store_unavailable";
        }
        records = next;
        return undefined;
      }),
    markSettled: (signature) =>
      queue.run(async () => {
        records = records.map((record) => (record.signature === signature ? { ...record, status: "settled" as const } : record));
        await persist(records).catch(() => undefined);
      }),
    find: (signature) => records.find((record) => record.signature === signature),
  };
}

export async function openUsedPayments(options: { readonly fs: FileSystem; readonly path: string }): Promise<UsedPayments> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, records: [] }) });
  const loaded = await file.load();
  return createUsedPayments(loaded.records, (records) => file.save({ version: 1, records: [...records] }));
}
