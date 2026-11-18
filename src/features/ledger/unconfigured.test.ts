import { describe, expect, it } from "vitest";
import { usdCents } from "@/shared";
import { createUnconfiguredLedger } from "./index";

describe("unconfigured ledger", () => {
  it("fails every operation with ledger-not-configured", async () => {
    const ledger = createUnconfiguredLedger();
    const failure = { ok: false, error: { code: "ledger-not-configured" } };
    expect(await ledger.debit("intent", usdCents(200), "intent|S|yes|200")).toEqual(failure);
    expect(await ledger.balance()).toEqual(failure);
  });
});
