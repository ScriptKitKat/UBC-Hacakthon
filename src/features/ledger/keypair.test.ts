import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { loadKeypair, loadKeypairFromJson } from "./keypair";

describe("loadKeypairFromJson", () => {
  it("loads a 64-byte secret key", () => {
    const expected = Keypair.generate();
    const loaded = loadKeypairFromJson(JSON.stringify(Array.from(expected.secretKey)));

    expect(loaded.publicKey.equals(expected.publicKey)).toBe(true);
  });

  it("uses the same error for malformed JSON and missing keypair files", async () => {
    expect(() => loadKeypairFromJson("not-json")).toThrow("Unable to load Solana keypair");
    await expect(loadKeypair("/missing/keypair.json")).rejects.toThrow("Unable to load Solana keypair");
  });
});
