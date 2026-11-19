import { describe, expect, it } from "vitest";
import { isSafeExplorerLink, isSafeGeminiLink } from "./safe-link";

describe("safe card links", () => {
  it("allows only https Gemini marketing hosts", () => {
    expect(isSafeGeminiLink("https://www.gemini.com/predictions/FED261211/fed-decision?status=active")).toBe(true);
    expect(isSafeGeminiLink("https://gemini.com/predictions/FED261211")).toBe(true);
    expect(isSafeGeminiLink("http://www.gemini.com/predictions/FED261211")).toBe(false);
    expect(isSafeGeminiLink("https://docs.gemini.com/predictions/FED261211")).toBe(false);
    expect(isSafeGeminiLink("https://www.gemini.com.evil.test/predictions")).toBe(false);
    expect(isSafeGeminiLink("https://evil.test/predictions")).toBe(false);
    expect(isSafeGeminiLink("javascript:alert(1)")).toBe(false);
  });

  it("allows only https Solana explorer receipts", () => {
    expect(isSafeExplorerLink("https://explorer.solana.com/tx/sig?cluster=devnet")).toBe(true);
    expect(isSafeExplorerLink("https://explorer.solana.com/tx/sig")).toBe(true);
    expect(isSafeExplorerLink("http://explorer.solana.com/tx/sig")).toBe(false);
    expect(isSafeExplorerLink("https://solscan.io/tx/sig")).toBe(false);
    expect(isSafeExplorerLink("https://explorer.solana.com.evil.test/tx/sig")).toBe(false);
    expect(isSafeExplorerLink("javascript:alert(1)")).toBe(false);
  });
});
