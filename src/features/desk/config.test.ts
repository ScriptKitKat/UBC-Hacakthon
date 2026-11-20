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
    const result = loadDeskConfig({ ...base, SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: "http://127.0.0.1:8899" });
    expect(result).toMatchObject({
      ok: true,
      value: { ledger: { configured: false, missing: ["SOLANA_KEYPAIR_PATH or SOLANA_KEYPAIR_JSON", "VAULT_RECIPIENT", "USDC_MINT"] } },
    });
  });

  it("rejects a malformed public key", () => {
    expect(loadDeskConfig({ ...base, USDC_MINT: "not-a-key" })).toMatchObject({ ok: false });
  });

  it.each(["localnet", "devnet"] as const)("reads the %s cluster explicitly", (cluster) => {
    const key = "11111111111111111111111111111111";
    const result = loadDeskConfig({
      ...base, SOLANA_CLUSTER: cluster, SOLANA_RPC_URL: "http://127.0.0.1:8899", SOLANA_KEYPAIR_PATH: "/k.json", VAULT_RECIPIENT: key, USDC_MINT: key,
    });
    expect(result).toMatchObject({ ok: true, value: { ledger: { configured: true, cluster } } });
  });

  it("accepts JSON keypairs and prefers them when both sources are set", () => {
    const key = "11111111111111111111111111111111";
    const keypairJson = JSON.stringify(Array(64).fill(0));
    const settings = {
      ...base,
      SOLANA_CLUSTER: "localnet",
      SOLANA_RPC_URL: "http://127.0.0.1:8899",
      VAULT_RECIPIENT: key,
      USDC_MINT: key,
      SOLANA_KEYPAIR_JSON: keypairJson,
    };
    const jsonOnly = loadDeskConfig(settings);
    const both = loadDeskConfig({ ...settings, SOLANA_KEYPAIR_PATH: "/k.json" });
    if (!jsonOnly.ok || !both.ok) throw new Error("expected ok");
    expect(jsonOnly.value.ledger).toMatchObject({ configured: true, keypairJson });
    expect(both.value.ledger).toMatchObject({ configured: true, keypairJson });
    expect(both.value.ledger).not.toHaveProperty("keypairPath");
  });

  it("requires the cluster to be named", () => {
    const key = "11111111111111111111111111111111";
    const result = loadDeskConfig({
      ...base, SOLANA_RPC_URL: "https://api.devnet.solana.com", SOLANA_KEYPAIR_PATH: "/k.json", VAULT_RECIPIENT: key, USDC_MINT: key,
    });
    expect(result).toMatchObject({ ok: true, value: { ledger: { configured: false, missing: ["SOLANA_CLUSTER"] } } });
  });

  it("rejects an unknown cluster", () => {
    expect(loadDeskConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta" })).toMatchObject({ ok: false });
  });

describe("research public origin", () => {
  it("defaults to the local desk and normalizes a configured origin", () => {
    const plain = loadDeskConfig(base);
    const custom = loadDeskConfig({ ...base, DESK_PUBLIC_ORIGIN: "https://Desk.Example.com:8443/some/path?x=1" });
    if (!plain.ok || !custom.ok) throw new Error("expected ok");
    expect(plain.value.research.publicOrigin).toBe("http://localhost:3000");
    expect(custom.value.research.publicOrigin).toBe("https://desk.example.com:8443");
  });

  it("rejects a malformed origin", () => {
    expect(loadDeskConfig({ ...base, DESK_PUBLIC_ORIGIN: "not a url" })).toMatchObject({ ok: false });
  });
});

describe("market policy and feed settings", () => {
  it("defaults the market categories and makes the allowlist optional", () => {
    const withoutAllowlist = Object.fromEntries(Object.entries(base).filter(([name]) => name !== "MARKET_ALLOWLIST"));
    const result = loadDeskConfig(withoutAllowlist);
    if (!result.ok) throw new Error(result.issues.join(";"));
    expect([...result.value.policy.marketCategories]).toEqual(["Economics", "Politics", "Tech", "Culture", "Crypto", "Commodities"]);
    expect([...result.value.policy.marketAllowlist]).toEqual([]);
  });

  it("reads custom market categories", () => {
    const result = loadDeskConfig({ ...base, MARKET_CATEGORIES: "Politics, Sports" });
    if (!result.ok) throw new Error(result.issues.join(";"));
    expect([...result.value.policy.marketCategories]).toEqual(["Politics", "Sports"]);
  });

  it.each([
    ["FEED_OPERATOR_ID first", { FEED_OPERATOR_ID: "feed" }, "feed"],
    ["then the first sender", {}, "priscilla"],
  ])("picks the feed operator: %s", (_name, extra, expected) => {
    const result = loadDeskConfig({ ...base, SENDER_ALLOWLIST: "priscilla,other", ...extra });
    if (!result.ok) throw new Error(result.issues.join(";"));
    expect(result.value.feed.operatorId).toBe(expected);
  });

  it("reads Grok settings with a default model and no key", () => {
    const plain = loadDeskConfig(base);
    const custom = loadDeskConfig({ ...base, XAI_API_KEY: "k", XAI_MODEL: "grok-x" });
    if (!plain.ok || !custom.ok) throw new Error("expected ok");
    expect(plain.value.feed.grok).toEqual({ apiKey: undefined, model: "grok-4.20-0309-non-reasoning" });
    expect(custom.value.feed.grok).toEqual({ apiKey: "k", model: "grok-x" });
  });
});

});
