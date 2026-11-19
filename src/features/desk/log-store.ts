import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import type { DecisionLogEntry } from "@/shared";

const outcome = z.enum(["yes", "no"]);

const entrySchema = z.object({
  entryId: z.string(),
  kind: z.enum(["approve", "needs-approval", "refuse", "execution-failed"]),
  code: z.exactOptional(z.string()),
  spokenReason: z.string(),
  intentId: z.string(),
  symbol: z.string(),
  outcome: outcome.nullable(),
  notionalCents: z.number(),
  senderId: z.string(),
  source: z.enum(["voice", "x", "desk", "feed", "research"]),
  signature: z.exactOptional(z.string()),
  explorerUrl: z.exactOptional(z.string()),
  ticket: z.exactOptional(
    z.object({ ticketId: z.string(), symbol: z.string(), outcome, quantity: z.string(), price: z.string(), mode: z.literal("paper") }),
  ),
  at: z.string(),
});

const fileSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });

export interface DecisionLogPersistence {
  readonly initialLog: readonly DecisionLogEntry[];
  readonly saveLog: (log: readonly DecisionLogEntry[]) => Promise<void>;
}

export async function openDecisionLog(options: { readonly fs: FileSystem; readonly path: string }): Promise<DecisionLogPersistence> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, entries: [] }) });
  const loaded = await file.load();
  return {
    initialLog: loaded.entries,
    saveLog: (log) => file.save({ version: 1, entries: [...log] }),
  };
}
