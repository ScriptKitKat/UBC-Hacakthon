import { z } from "zod";
import { StoreUnavailableError, createJsonStore, createSerialQueue } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import type { PaymentErrorCode } from "./schema";

const COMPACTION_THRESHOLD = 1000;
const EXPIRY_MARGIN_BLOCKS = 150;
const RETENTION_MS = 24 * 60 * 60 * 1000;

const recordSchema = z.object({
  nonce: z.string(),
  signature: z.string(),
  atMs: z.number(),
  symbol: z.string().default(""),
  payer: z.string().default(""),
  lastValidBlockHeight: z.number().int().optional(),
  status: z.enum(["claimed", "settled", "failed"]).default("claimed"),
});
const fileSchema = z.object({ version: z.literal(1), records: z.array(recordSchema) });

export type UsedPayment = z.output<typeof recordSchema>;
export type NewUsedPayment = Pick<UsedPayment, "nonce" | "signature" | "atMs" | "symbol" | "payer" | "lastValidBlockHeight">;

export type ReuseError = Extract<PaymentErrorCode, "nonce_reused" | "signature_reused" | "store_unavailable">;

export interface UsedPayments {
  readonly reuse: (nonce: string, signature: string) => ReuseError | undefined;
  readonly claim: (payment: NewUsedPayment) => Promise<ReuseError | undefined>;
  readonly markSettled: (signature: string) => Promise<void>;
  readonly markFailed: (signature: string) => Promise<void>;
  readonly find: (signature: string) => UsedPayment | undefined;
  readonly claimed: () => readonly UsedPayment[];
  readonly flush: () => Promise<void>;
}

interface RetentionOptions {
  readonly nowMs?: () => number;
  readonly protectedSignatures?: () => ReadonlySet<string>;
  readonly finalizedHeight?: () => Promise<number | undefined>;
}

async function compact(records: readonly UsedPayment[], options: RetentionOptions): Promise<readonly UsedPayment[]> {
  const cutoff = (options.nowMs ?? Date.now)() - RETENTION_MS;
  const candidates = records.filter((record) => {
    const nonceExpiry = Number(record.nonce.split(".", 1)[0]);
    return record.status === "settled" && record.lastValidBlockHeight !== undefined
      && record.atMs < cutoff && !(nonceExpiry >= cutoff);
  });
  if (!candidates.length) return records;
  const height = await options.finalizedHeight?.().catch(() => undefined);
  if (height === undefined) return records;
  const protectedSignatures = options.protectedSignatures?.();
  const expired = new Set(candidates.filter((record) =>
    !protectedSignatures?.has(record.signature) && height > (record.lastValidBlockHeight ?? Infinity) + EXPIRY_MARGIN_BLOCKS));
  return records.filter((record) => !expired.has(record));
}

export function createUsedPayments(
  initial: readonly UsedPayment[],
  persist: (records: readonly UsedPayment[]) => Promise<void>,
  options: RetentionOptions = {},
  flushStore: () => Promise<void> = () => Promise.resolve(),
): UsedPayments {
  let records: readonly UsedPayment[] = [...initial];
  const queue = createSerialQueue();

  function reuse(nonce: string, signature: string): ReuseError | undefined {
    if (records.some((record) => record.nonce === nonce)) return "nonce_reused";
    if (records.some((record) => record.signature === signature)) return "signature_reused";
    return undefined;
  }

  async function save(next: readonly UsedPayment[]): Promise<void> {
    const kept = next.length > COMPACTION_THRESHOLD ? await compact(next, options) : next;
    await persist(kept);
    records = kept;
  }

  function resolve(signature: string, status: "settled" | "failed"): Promise<void> {
    return queue.run(async () => {
      if (!records.some((record) => record.signature === signature && record.status === "claimed")) return;
      await save(records.map((record) => record.signature === signature ? { ...record, status } : record));
    });
  }

  return {
    reuse,
    claim: (payment) =>
      queue.run(async () => {
        const already = reuse(payment.nonce, payment.signature);
        if (already) return already;
        try {
          await save([...records, { ...payment, status: "claimed" }]);
        } catch {
          return "store_unavailable";
        }
      }),
    markSettled: (signature) => resolve(signature, "settled"),
    markFailed: (signature) => resolve(signature, "failed"),
    find: (signature) => records.find((record) => record.signature === signature),
    claimed: () => records.filter((record) => record.status === "claimed"),
    async flush() {
      await queue.flush();
      await flushStore();
    },
  };
}

export async function openUsedPayments(options: RetentionOptions & { readonly fs: FileSystem; readonly path: string }): Promise<UsedPayments> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, records: [] }) });
  const loaded = await file.load();
  const save = (records: readonly UsedPayment[]) => file.save({ version: 1, records: [...records] });
  const records = await compact(loaded.records, options);
  if (records.length !== loaded.records.length) {
    await save(records).catch(() => { throw new StoreUnavailableError("unreadable", options.path); });
  }
  return createUsedPayments(records, save, options, file.flush);
}
