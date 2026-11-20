import { describe, expect, it, vi } from "vitest";
import { composeMessage } from "./message";
import { defaultAgent } from "./store";
import type { AgentModel } from "./types";

const NOW = new Date("2026-11-19T12:00:00Z");
const snapshot = { eventTitle: "Bitcoin price today?", yesCents: 62, yesCents24hAgo: 50, volume24h: null, volumeTotal: null, createdAt: null, expiryDate: null };
const result = { fired: ["oddsMove"] as const, skipped: [], todayPoints: 12 };
const keyed = { apiKey: "k", model: "m" };
const unkeyed = { apiKey: undefined, model: "m" };

function compose(model: AgentModel, keys: { grok: typeof keyed | typeof unkeyed; claude: typeof keyed | typeof unkeyed }, fake: typeof fetch) {
  const agent = defaultAgent({ eventTicker: "BTC", instrumentSymbol: "BTC-YES", name: "Scout", model }, NOW);
  return composeMessage({ agent, result, snapshot, now: NOW, ...keys, fetch: fake });
}

describe("composeMessage", () => {
  it("asks Claude for a Claude agent", async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ content: [{ type: "tool_use", name: "agent_message", input: { message: "Odds jumped." } }] })));
    expect(await compose("claude", { grok: keyed, claude: keyed }, fake)).toEqual({ text: "Odds jumped.", source: "llm" });
    expect(fake.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("asks Grok for a Grok agent", async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ choices: [{ message: { content: '{"message":"Odds jumped."}' } }] })));
    expect(await compose("grok", { grok: keyed, claude: keyed }, fake)).toEqual({ text: "Odds jumped.", source: "llm" });
    expect(fake.mock.calls[0]?.[0]).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("uses the template when the agent's own model has no key", async () => {
    const fake = vi.fn<typeof fetch>();
    expect((await compose("claude", { grok: keyed, claude: unkeyed }, fake)).source).toBe("template");
    expect((await compose("grok", { grok: unkeyed, claude: keyed }, fake)).source).toBe("template");
    expect(fake).not.toHaveBeenCalled();
  });
});
