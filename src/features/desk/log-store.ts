import { z } from "zod";
import { openSpendJournal } from "@/features/journal";
import type { SpendEntry } from "@/features/journal";
import { StoreUnavailableError, createJsonStore } from "@/features/storage";
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

export async function openMigratedSpendJournal(
  options: Parameters<typeof openSpendJournal>[0],
  log: readonly DecisionLogEntry[],
): ReturnType<typeof openSpendJournal> {
  const journal = await openSpendJournal(options);
  const settled = log.flatMap((entry): SpendEntry[] => {
    if (entry.kind !== "approve" || !entry.signature) return [];
    return [{
      operationId: entry.intentId,
      kind: entry.source === "research" ? "research" : "trade",
      status: "settled",
      notionalCents: entry.notionalCents,
      symbol: entry.symbol,
      outcome: entry.outcome,
      senderId: entry.senderId,
      source: entry.source,
      reservedAt: entry.at,
      resolvedAt: entry.at,
      signature: entry.signature,
      ...(entry.explorerUrl === undefined ? {} : { explorerUrl: entry.explorerUrl }),
      ...(entry.ticket === undefined ? {} : { ticket: entry.ticket }),
    }];
  });
  if (!(await journal.adoptSettled(settled)).ok) throw new StoreUnavailableError("unreadable", options.path);
  return journal;
}
