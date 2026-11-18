import { describe, expect, it } from "vitest";
import { loadDeskConfig } from "./config";

const base = {
  DAILY_CAP_USD: "20",
  AUTO_APPROVE_MAX_USD: "2",
  MARKET_ALLOWLIST: "A-1, B-2",
  SENDER_ALLOWLIST: "priscilla",
};

describe("loadDeskConfig", () => {
  it("parses dollars into cents, applies the per-trade default and lists allowlists", () => {
    const result = loadDeskConfig(base);
    if (!result.ok) throw new Error(result.issues.join(";"));
    expect(result.value.policy).toMatchObject({ dailyCap: 2000, autoApproveMax: 200, perTradeMax: 1000, killSwitch: false });
    expect([...result.value.policy.marketAllowlist]).toEqual(["A-1", "B-2"]);
    expect([...result.value.policy.senderAllowlist]).toEqual(["priscilla"]);
  });

  it("reports every missing or malformed setting with its name", () => {
    const result = loadDeskConfig({ DAILY_CAP_USD: "twenty", MARKET_ALLOWLIST: " , " });
    expect(result).toMatchObject({ ok: false });
    const issues = result.ok ? [] : result.issues.join("\n");
    expect(issues).toContain("DAILY_CAP_USD");
    expect(issues).toContain("AUTO_APPROVE_MAX_USD");
    expect(issues).toContain("MARKET_ALLOWLIST");
    expect(issues).toContain("SENDER_ALLOWLIST");
  });

  it("rejects caps that are out of order", () => {
    expect(loadDeskConfig({ ...base, AUTO_APPROVE_MAX_USD: "15" })).toMatchObject({ ok: false });
  });

  it("lists the missing ledger settings instead of failing", () => {
    const result = loadDeskConfig({ ...base, SOLANA_RPC_URL: "http://127.0.0.1:8899" });
    expect(result).toMatchObject({
      ok: true,
      value: { ledger: { configured: false, missing: ["SOLANA_KEYPAIR_PATH", "VAULT_RECIPIENT", "USDC_MINT"] } },
    });
  });

  it("rejects a malformed public key", () => {
    expect(loadDeskConfig({ ...base, USDC_MINT: "not-a-key" })).toMatchObject({ ok: false });
  });

  it("detects a localnet cluster from the rpc url", () => {
    const key = "11111111111111111111111111111111";
    const result = loadDeskConfig({
      ...base, SOLANA_RPC_URL: "http://127.0.0.1:8899", SOLANA_KEYPAIR_PATH: "/k.json", VAULT_RECIPIENT: key, USDC_MINT: key,
    });
    expect(result).toMatchObject({ ok: true, value: { ledger: { configured: true, cluster: "localnet" } } });
  });
});
