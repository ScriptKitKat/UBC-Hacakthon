import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildAgentConfig, clientToolConfigs } from "./agent-config";
import { createClientTools } from "./client-tools";
import { VOICE_TOOL_NAMES } from "./tools";
import type { VoiceToolName } from "./tools";

describe("agent config", () => {
  it("configures exactly the tools the browser registers and the server runs", () => {
    const registered = Object.keys(createClientTools(() => Promise.resolve("{}")));
    expect(Object.keys(clientToolConfigs).sort()).toEqual([...VOICE_TOOL_NAMES].sort());
    expect(registered.sort()).toEqual([...VOICE_TOOL_NAMES].sort());
  });

  it("forwards each registered tool under its own name with its parameters", async () => {
    const calls: [VoiceToolName, unknown][] = [];
    const tools = createClientTools((name, parameters) => {
      calls.push([name, parameters]);
      return Promise.resolve("ok");
    });
    for (const name of VOICE_TOOL_NAMES) await tools[name]({ marker: name });
    expect(calls).toEqual(VOICE_TOOL_NAMES.map((name) => [name, { marker: name }]));
  });

  it.each(VOICE_TOOL_NAMES)("declares %s as a blocking client tool", (name) => {
    expect(clientToolConfigs[name]).toMatchObject({ type: "client", name, expects_response: true });
    expect(clientToolConfigs[name].description.length).toBeGreaterThan(20);
  });

  it("derives parameter schemas from the zod schemas", () => {
    expect(clientToolConfigs.propose_trade.parameters).toEqual({
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["yes", "no"], description: expect.any(String) as unknown },
        amount_usd: { type: "number", description: expect.any(String) as unknown },
      },
      required: ["outcome", "amount_usd"],
    });
    expect(clientToolConfigs.approve_pending_trade.parameters).toEqual({
      type: "object",
      properties: { intent_id: { type: "string", description: expect.any(String) as unknown } },
    });
    expect(clientToolConfigs.get_market_quote).not.toHaveProperty("parameters");
    expect(clientToolConfigs.get_desk_status).not.toHaveProperty("parameters");
  });

  it("attaches tools through tool_ids and carries the safety rules in the prompt", () => {
    const config = buildAgentConfig(["tool_a", "tool_b"]);
    expect(config.conversation_config.agent.prompt.tool_ids).toEqual(["tool_a", "tool_b"]);
    expect(config.conversation_config.agent.prompt).not.toHaveProperty("tools");
    expect(config.conversation_config.agent.first_message.length).toBeGreaterThan(0);
    expect(SYSTEM_PROMPT).toContain("Always call get_market_quote before");
    expect(SYSTEM_PROMPT).toContain("explicit confirmation");
    expect(SYSTEM_PROMPT).toContain("verbatim");
    expect(SYSTEM_PROMPT).toContain("Never invent prices");
    for (const name of VOICE_TOOL_NAMES) expect(SYSTEM_PROMPT + JSON.stringify(clientToolConfigs)).toContain(name);
  });
});
