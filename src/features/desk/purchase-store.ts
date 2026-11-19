import { z } from "zod";
import { researchBriefSchema } from "@/shared";
import type { ResearchBrief } from "@/shared";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";

export const UNDELIVERED_RECOVERY_MS = 24 * 60 * 60 * 1000;

const purchaseSchema = z.object({
  symbol: z.string(),
  atMs: z.number(),
  brief: researchBriefSchema.nullable(),
  receipt: z.object({ signature: z.string(), explorerUrl: z.string(), costCents: z.number() }),
});

const fileSchema = z.object({ version: z.literal(1), purchases: z.array(purchaseSchema) });

export type StoredPurchase = z.output<typeof purchaseSchema>;
export type { ResearchBrief };

export interface PurchasePersistence {
  readonly initialPurchases: readonly StoredPurchase[];
  readonly savePurchases: (purchases: readonly StoredPurchase[]) => Promise<void>;
}

export async function openPurchaseStore(options: { readonly fs: FileSystem; readonly path: string }): Promise<PurchasePersistence> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, purchases: [] }) });
  const loaded = await file.load();
  return {
    initialPurchases: loaded.purchases,
    savePurchases: (purchases) => file.save({ version: 1, purchases: [...purchases] }),
  };
}
