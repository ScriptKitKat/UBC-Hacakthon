import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { createMemoryJournal, openSpendJournal, reconcileJournal } from "./index";
import type { SpendOpening } from "./index";

const PATH = "/data/spend-journal.json";
const NOW = "2026-11-18T10:00:00.000Z";

const trade: SpendOpening = {
  operationId: "op-1",
  kind: "trade",
  notionalCents: 100,
  symbol: "GEMI-A-B",
  outcome: "yes",
  senderId: "me",
  source: "desk",
};
const payment = { signature: "sig-1", blockhash: "hash-1", lastValidBlockHeight: 123, explorerUrl: "https://x/sig-1" };

describe("spend journal", () => {
  it("persists a reservation before begin resolves and survives a reopen", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: PATH, nowIso: () => NOW });
    expect(await journal.begin(trade)).toEqual({ ok: true });
    expect(await journal.attachPayment("op-1", payment)).toEqual({ ok: true });
    const reopened = await openSpendJournal({ fs, path: PATH, nowIso: () => NOW });
    expect(reopened.entries()).toEqual([{ ...trade, status: "reserved", reservedAt: NOW, ...payment }]);
  });

  it("refuses a second operation with the same id", async () => {
    const journal = createMemoryJournal(() => NOW);
    await journal.begin(trade);
    expect(await journal.begin(trade)).toEqual({ ok: false, error: "duplicate-operation" });
  });

  it("rejects updates to an unknown operation", async () => {
    expect(await createMemoryJournal(() => NOW).settle("nope")).toEqual({ ok: false, error: "unknown-operation" });
  });

  it("reports an unavailable journal and does not keep the reservation counted when it could not be written", async () => {
    const memory = createMemoryFileSystem();
    const fs = { ...memory, writeTextAtomic: () => Promise.reject(new Error("ENOSPC")) };
    const journal = await openSpendJournal({ fs, path: PATH, nowIso: () => NOW });
    expect(await journal.begin(trade)).toEqual({ ok: false, error: "journal-unavailable" });
    expect(journal.entries().map((entry) => entry.status)).toEqual(["failed"]);
  });

  it("a failed write for one entry never drops a later entry", async () => {
    const memory = createMemoryFileSystem();
    let writes = 0;
    const fs = {
      ...memory,
      writeTextAtomic: async (path: string, contents: string) => {
        writes += 1;
        if (writes > 1) return memory.writeTextAtomic(path, contents);
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("EIO");
      },
    };
    const journal = await openSpendJournal({ fs, path: PATH, nowIso: () => NOW });
    const first = journal.begin(trade);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = journal.begin({ ...trade, operationId: "op-2" });
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(true);
    const reopened = await openSpendJournal({ fs, path: PATH, nowIso: () => NOW });
    expect(reopened.entries().map((entry) => entry.operationId)).toContain("op-2");
  });

  it("refuses to open a corrupt journal and preserves it", async () => {
    const fs = createMemoryFileSystem({ [PATH]: "{oops" });
    await expect(openSpendJournal({ fs, path: PATH, nowIso: () => NOW })).rejects.toMatchObject({ name: "StoreUnavailableError" });
    expect([...fs.files.keys()].some((name) => name.includes(".corrupt-"))).toBe(true);
  });
});

describe("reconcileJournal", () => {
  async function seeded() {
    const journal = createMemoryJournal(() => NOW);
    await journal.begin(trade);
    await journal.attachPayment("op-1", payment);
    await journal.begin({ ...trade, operationId: "op-2" });
    await journal.begin({ ...trade, operationId: "op-3" });
    await journal.attachPayment("op-3", { ...payment, signature: "sig-3" });
    return journal;
  }

  it("settles landed payments, fails ones that never landed or were never signed, and keeps pending ones reserved", async () => {
    const journal = await seeded();
    const result = await reconcileJournal(journal, ({ signature }) => Promise.resolve(signature === "sig-1" ? "landed" : "pending"));
    expect(result).toEqual({ settled: 1, failed: 1, stillReserved: 1 });
    expect(Object.fromEntries(journal.entries().map((entry) => [entry.operationId, entry.status]))).toEqual({
      "op-1": "settled",
      "op-2": "failed",
      "op-3": "reserved",
    });
  });

  it("fails a payment whose blockhash expired without landing", async () => {
    const journal = await seeded();
    await reconcileJournal(journal, () => Promise.resolve("failed"));
    expect(journal.entries().every((entry) => entry.status === "failed")).toBe(true);
  });
});
