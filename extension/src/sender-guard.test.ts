import { describe, expect, it } from "vitest";
import { isTrustedSender } from "./sender-guard";

const ID = "abcdefghijklmnopabcdefghijklmnop";

describe("isTrustedSender", () => {
  it.each(["https://x.com/home", "https://twitter.com/i/status/1", "https://x.com/"])("accepts own content scripts on %s", (url) => {
    expect(isTrustedSender({ id: ID, tab: { url } }, ID)).toBe(true);
  });

  it("accepts the extension's own pages", () => {
    expect(isTrustedSender({ id: ID, url: `chrome-extension://${ID}/options.html` }, ID)).toBe(true);
    expect(isTrustedSender({ id: ID, tab: { url: `chrome-extension://${ID}/options.html` } }, ID)).toBe(true);
  });

  it.each([
    ["another extension", { id: "other", tab: { url: "https://x.com/home" } }],
    ["no id", { tab: { url: "https://x.com/home" } }],
    ["lookalike host", { id: ID, tab: { url: "https://x.com.evil.test/home" } }],
    ["subdomain", { id: ID, tab: { url: "https://evil.x.com/home" } }],
    ["http x", { id: ID, tab: { url: "http://x.com/home" } }],
    ["other site", { id: ID, tab: { url: "https://example.com/" } }],
    ["unparseable tab url", { id: ID, tab: { url: "not a url" } }],
    ["no tab and no url", { id: ID }],
    ["no tab with foreign url", { id: ID, url: "https://x.com/" }],
    ["another extension's page", { id: ID, url: `chrome-extension://${"b".repeat(32)}/options.html` }],
  ])("rejects %s", (_name, sender) => {
    expect(isTrustedSender(sender, ID)).toBe(false);
  });
});
