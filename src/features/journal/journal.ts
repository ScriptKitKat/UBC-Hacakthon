import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem, JsonStore } from "@/features/storage";

const outcome = z.enum(["yes", "no"]);

const ticketSchema = z.object({
  ticketId: z.string(),
  symbol: z.string(),
  outcome,
  quantity: z.string(),
  price: z.string(),
  mode: z.literal("paper"),
});

const entrySchema = z.object({
  operationId: z.string(),
  kind: z.enum(["trade", "research"]),
  status: z.enum(["reserved", "settled", "failed"]),
  notionalCents: z.number().int().positive(),
  symbol: z.string(),
  outcome: outcome.nullable(),
  senderId: z.string(),
  source: z.enum(["voice", "x", "desk", "feed", "research"]),
  reservedAt: z.string(),
  resolvedAt: z.exactOptional(z.string()),
  signature: z.exactOptional(z.string()),
  blockhash: z.exactOptional(z.string()),
  lastValidBlockHeight: z.exactOptional(z.number().int()),
  explorerUrl: z.exactOptional(z.string()),
  ticket: z.exactOptional(ticketSchema),
});

const fileSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });

export type SpendEntry = z.output<typeof entrySchema>;
export type SpendOpening = Pick<SpendEntry, "operationId" | "kind" | "notionalCents" | "symbol" | "outcome" | "senderId" | "source" | "ticket">;
export type SignedPaymentRef = Required<Pick<SpendEntry, "signature" | "blockhash" | "lastValidBlockHeight" | "explorerUrl">>;

export type JournalWriteError = "journal-unavailable" | "duplicate-operation" | "unknown-operation";

export type JournalWrite = { readonly ok: true } | { readonly ok: false; readonly error: JournalWriteError };

export interface SpendJournal {
  readonly begin: (opening: SpendOpening) => Promise<JournalWrite>;
  readonly attachPayment: (operationId: string, payment: SignedPaymentRef) => Promise<JournalWrite>;
  readonly settle: (operationId: string) => Promise<JournalWrite>;
  readonly fail: (operationId: string) => Promise<JournalWrite>;
  readonly entries: () => readonly SpendEntry[];
  readonly adoptSettled: (entries: readonly SpendEntry[]) => Promise<JournalWrite>;
}

export interface OpenJournalOptions {
  readonly fs: FileSystem;
  readonly path: string;
  readonly nowIso: () => string;
}

const UNAVAILABLE: JournalWrite = { ok: false, error: "journal-unavailable" };
const OK: JournalWrite = { ok: true };

type JournalFile = z.output<typeof fileSchema>;

function createJournal(initial: readonly SpendEntry[], store: Pick<JsonStore<JournalFile>, "save">, nowIso: () => string): SpendJournal {
  const byId = new Map<string, SpendEntry>(initial.map((entry) => [entry.operationId, entry]));

  async function persist(): Promise<JournalWrite> {
    try {
      await store.save({ version: 1, entries: [...byId.values()] });
      return OK;
    } catch {
      return UNAVAILABLE;
    }
  }

  function update(operationId: string, change: Partial<SpendEntry>): Promise<JournalWrite> {
    const existing = byId.get(operationId);
    if (!existing) return Promise.resolve({ ok: false, error: "unknown-operation" });
    byId.set(operationId, { ...existing, ...change });
    return persist();
  }

  return {
    async begin(opening) {
      if (byId.has(opening.operationId)) return { ok: false, error: "duplicate-operation" };
      const reservedAt = nowIso();
      byId.set(opening.operationId, { ...opening, status: "reserved", reservedAt });
      const written = await persist();
      if (!written.ok) byId.set(opening.operationId, { ...opening, status: "failed", reservedAt, resolvedAt: nowIso() });
      return written;
    },
    attachPayment: (operationId, payment) => update(operationId, payment),
    settle: (operationId) => update(operationId, { status: "settled", resolvedAt: nowIso() }),
    fail: (operationId) => update(operationId, { status: "failed", resolvedAt: nowIso() }),
    entries: () => [...byId.values()],
    async adoptSettled(adopted) {
      const knownSignatures = new Set([...byId.values()].flatMap(({ signature }) => (signature === undefined ? [] : [signature])));
      const previousEntries = new Map<string, SpendEntry | undefined>();
      for (const entry of adopted) {
        const { operationId, signature } = entry;
        const existing = byId.get(operationId);
        if (signature === undefined) continue;
        if (existing) {
          if (existing.status !== "reserved" || existing.signature !== signature) continue;
        } else if (knownSignatures.has(signature)) continue;
        previousEntries.set(operationId, existing);
        byId.set(operationId, { ...entry, ...existing, status: "settled" });
        knownSignatures.add(signature);
      }
      if (previousEntries.size === 0) return OK;
      const written = await persist();
      if (!written.ok) {
        for (const [operationId, previous] of previousEntries) {
          if (previous) byId.set(operationId, previous);
          else byId.delete(operationId);
        }
      }
      return written;
    },
  };
}

export async function openSpendJournal(options: OpenJournalOptions): Promise<SpendJournal> {
  const store = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, entries: [] }) });
  const loaded = await store.load();
  return createJournal(loaded.entries, store, options.nowIso);
}

export function createMemoryJournal(nowIso: () => string): SpendJournal {
  return createJournal([], { save: () => Promise.resolve() }, nowIso);
}

export type SignatureOutcome = "landed" | "failed" | "pending";

export interface Reconciliation {
  readonly settled: number;
  readonly failed: number;
  readonly stillReserved: number;
}

export interface PaymentToCheck {
  readonly signature: string;
  readonly lastValidBlockHeight: number | undefined;
}

export async function reconcileJournal(
  journal: SpendJournal,
  check: (payment: PaymentToCheck) => Promise<SignatureOutcome>,
): Promise<Reconciliation> {
  let settled = 0;
  let failed = 0;
  let stillReserved = 0;
  for (const entry of journal.entries().filter(({ status }) => status === "reserved")) {
    const { signature, lastValidBlockHeight } = entry;
    const outcomeOnChain: SignatureOutcome = signature === undefined ? "failed" : await check({ signature, lastValidBlockHeight });
    if (outcomeOnChain === "landed") {
      await journal.settle(entry.operationId);
      settled += 1;
    } else if (outcomeOnChain === "failed") {
      await journal.fail(entry.operationId);
      failed += 1;
    } else {
      stillReserved += 1;
    }
  }
  return { settled, failed, stillReserved };
}
