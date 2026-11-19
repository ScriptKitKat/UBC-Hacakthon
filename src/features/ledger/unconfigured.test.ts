import { describe, expect, it } from "vitest";
import { usdCents } from "@/shared";
import { createUnconfiguredLedger } from "./index";

describe("unconfigured ledger", () => {
  it("fails every operation with ledger-not-configured", async () => {
    const ledger = createUnconfiguredLedger();
    const failure = { ok: false, error: { code: "ledger-not-configured" } };
    expect(await ledger.debit("intent", usdCents(200), "intent|S|yes|200", () => Promise.resolve(true))).toEqual(failure);
    expect(await ledger.checkSignature({ signature: "s", lastValidBlockHeight: 123 })).toBe("pending");
    expect(await ledger.balance()).toEqual(failure);
  });
});
