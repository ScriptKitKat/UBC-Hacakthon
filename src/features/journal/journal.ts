import { z } from "zod";
import { StoreUnavailableError, createJsonStore, createSerialQueue } from "@/features/storage";
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
  readonly find: (operationId: string) => SpendEntry | undefined;
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

const COMPACTION_THRESHOLD = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function retained(entry: SpendEntry, nowIso: string): boolean {
  if (entry.status === "reserved" || (entry.status === "settled" && entry.kind === "trade")) return true;
  const cutoff = Date.parse(nowIso.slice(0, 10)) - DAY_MS;
  return !(Date.parse(entry.reservedAt) < cutoff && Date.parse(entry.resolvedAt ?? entry.reservedAt) < cutoff);
}

function createJournal(initial: readonly SpendEntry[], store: Pick<JsonStore<JournalFile>, "save">, nowIso: () => string): SpendJournal {
  let byId = new Map(initial.map((entry) => [entry.operationId, entry]));
  const openingEntries = new Map<string, SpendEntry>();
  const queue = createSerialQueue();

  async function persist(next: Map<string, SpendEntry>): Promise<JournalWrite> {
    const entries = [...next.values()];
    const kept = entries.length > COMPACTION_THRESHOLD ? entries.filter((entry) => retained(entry, nowIso())) : entries;
    try {
      await store.save({ version: 1, entries: kept });
      byId = kept.length === entries.length ? next : new Map(kept.map((entry) => [entry.operationId, entry]));
      return OK;
    } catch {
      return UNAVAILABLE;
    }
  }

  function update(operationId: string, change: Partial<SpendEntry>): Promise<JournalWrite> {
    return queue.run(async () => {
      const existing = byId.get(operationId);
      if (!existing) return { ok: false, error: "unknown-operation" };
      if (existing.status !== "reserved") return { ok: false, error: "duplicate-operation" };
      return persist(new Map(byId).set(operationId, { ...existing, ...change }));
    });
  }

  return {
    async begin(opening) {
      const { operationId } = opening;
      if (byId.has(operationId) || openingEntries.has(operationId)) return { ok: false, error: "duplicate-operation" };
      const entry: SpendEntry = { ...opening, status: "reserved", reservedAt: nowIso() };
      openingEntries.set(operationId, entry);
      return queue.run(async () => {
        const written = await persist(new Map(byId).set(operationId, entry));
        openingEntries.delete(operationId);
        if (!written.ok) byId.set(operationId, { ...entry, status: "failed", resolvedAt: nowIso() });
        return written;
      });
    },
    attachPayment: (operationId, payment) => update(operationId, payment),
    settle: (operationId) => update(operationId, { status: "settled", resolvedAt: nowIso() }),
    fail: (operationId) => update(operationId, { status: "failed", resolvedAt: nowIso() }),
    find: (operationId) => byId.get(operationId) ?? openingEntries.get(operationId),
    entries: () => [...byId.values(), ...[...openingEntries.values()].filter(({ operationId }) => !byId.has(operationId))],
    adoptSettled: (adopted) => queue.run(async () => {
      const knownSignatures = new Set([...byId.values()].flatMap(({ signature }) => (signature === undefined ? [] : [signature])));
      const next = new Map(byId);
      let changed = false;
      for (const entry of adopted) {
        const { operationId, signature } = entry;
        const existing = next.get(operationId);
        if (signature === undefined || (!existing && !retained(entry, nowIso()))) continue;
        if (existing) {
          if (existing.status !== "reserved" || existing.signature !== signature) continue;
        } else if (knownSignatures.has(signature)) continue;
        next.set(operationId, { ...entry, ...existing, status: "settled" });
        knownSignatures.add(signature);
        changed = true;
      }
      return changed ? persist(next) : OK;
    }),
  };
}

export async function openSpendJournal(options: OpenJournalOptions): Promise<SpendJournal> {
  const store = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, entries: [] }) });
  const loaded = await store.load();
  const entries = loaded.entries.filter((entry) => retained(entry, options.nowIso()));
  if (entries.length !== loaded.entries.length) {
    await store.save({ version: 1, entries }).catch(() => { throw new StoreUnavailableError("unreadable", options.path); });
  }
  return createJournal(entries, store, options.nowIso);
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
  inFlight: ReadonlySet<string> = new Set(),
  paymentInFlight?: (signature: string) => boolean,
): Promise<Reconciliation> {
  let settled = 0;
  let failed = 0;
  let stillReserved = 0;
  for (const entry of journal.entries().filter(({ status }) => status === "reserved")) {
    const { signature, lastValidBlockHeight } = entry;
    if (inFlight.has(entry.operationId) || (signature !== undefined && paymentInFlight?.(signature))) {
      stillReserved += 1;
      continue;
    }
    const outcomeOnChain: SignatureOutcome = signature === undefined ? "failed" : await check({ signature, lastValidBlockHeight }).catch(() => "pending" as const);
    if (outcomeOnChain === "landed" && (await journal.settle(entry.operationId)).ok) settled += 1;
    else if (outcomeOnChain === "failed" && (await journal.fail(entry.operationId)).ok) failed += 1;
    else stillReserved += 1;
  }
  return { settled, failed, stillReserved };
}
