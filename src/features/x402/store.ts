import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import type { PaymentErrorCode } from "./schema";

const RETENTION_MS = 24 * 60 * 60 * 1000;

const recordSchema = z.object({ nonce: z.string(), signature: z.string(), atMs: z.number() });
const fileSchema = z.object({ version: z.literal(1), records: z.array(recordSchema) });

type UsedPayment = z.output<typeof recordSchema>;

export type ReuseError = Extract<PaymentErrorCode, "nonce_reused" | "signature_reused" | "store_unavailable">;

export interface UsedPayments {
  readonly reuse: (nonce: string, signature: string) => ReuseError | undefined;
  readonly claim: (nonce: string, signature: string, atMs: number) => Promise<ReuseError | undefined>;
}

export function createUsedPayments(initial: readonly UsedPayment[], persist: (records: readonly UsedPayment[]) => Promise<void>): UsedPayments {
  let records: readonly UsedPayment[] = [...initial];

  function reuse(nonce: string, signature: string): ReuseError | undefined {
    if (records.some((record) => record.nonce === nonce)) return "nonce_reused";
    if (records.some((record) => record.signature === signature)) return "signature_reused";
    return undefined;
  }

  return {
    reuse,
    async claim(nonce, signature, atMs) {
      const already = reuse(nonce, signature);
      if (already) return already;
      const before = records;
      records = [...records.filter((record) => atMs - record.atMs < RETENTION_MS), { nonce, signature, atMs }];
      try {
        await persist(records);
        return undefined;
      } catch {
        records = before;
        return "store_unavailable";
      }
    },
  };
}

export async function openUsedPayments(options: { readonly fs: FileSystem; readonly path: string }): Promise<UsedPayments> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, records: [] }) });
  const loaded = await file.load();
  return createUsedPayments(loaded.records, (records) => file.save({ version: 1, records: [...records] }));
}
