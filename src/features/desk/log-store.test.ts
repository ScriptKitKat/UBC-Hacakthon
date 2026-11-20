import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { openDecisionLog } from "./log-store";

const PATH = "/data/decision-log.json";

describe("decision log", () => {
  it("opens a log that still holds a decision from the retired voice source", async () => {
    const stored = {
      entryId: "entry-1",
      kind: "approve",
      spokenReason: "Placed.",
      intentId: "intent-1",
      symbol: "GEMI-A-B",
      outcome: "yes",
      notionalCents: 100,
      senderId: "me",
      source: "voice",
      at: "2026-11-18T10:00:00.000Z",
    };
    const fs = createMemoryFileSystem({ [PATH]: JSON.stringify({ version: 1, entries: [stored] }) });
    const log = await openDecisionLog({ fs, path: PATH });
    expect(log.initialLog).toEqual([stored]);
  });
});
