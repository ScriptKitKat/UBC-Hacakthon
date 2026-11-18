import { describe, expect, it } from "vitest";
import { createFakeElevenLabsAdmin } from "./fake-admin";
import { setupVoiceAgent } from "./setup";
import { VOICE_TOOL_NAMES } from "./tools";

describe("setupVoiceAgent", () => {
  it("creates every tool and the agent on a fresh workspace", async () => {
    const admin = createFakeElevenLabsAdmin();
    const result = await setupVoiceAgent(admin);
    if (!result.ok) throw new Error("setup failed");
    expect(result.value.agentCreated).toBe(true);
    expect(result.value.tools.map((tool) => tool.name)).toEqual([...VOICE_TOOL_NAMES]);
    expect(admin.tools.size).toBe(VOICE_TOOL_NAMES.length);
    expect(admin.agents.get(result.value.agentId)?.conversation_config.agent.prompt.tool_ids).toEqual(
      result.value.tools.map((tool) => tool.id),
    );
  });

  it("is idempotent: rerunning with the agent id updates in place", async () => {
    const admin = createFakeElevenLabsAdmin();
    const first = await setupVoiceAgent(admin);
    if (!first.ok) throw new Error("setup failed");
    const second = await setupVoiceAgent(admin, { agentId: first.value.agentId });
    if (!second.ok) throw new Error("setup failed");
    expect(second.value.agentCreated).toBe(false);
    expect(second.value.agentId).toBe(first.value.agentId);
    expect(second.value.tools).toEqual(first.value.tools);
    expect(admin.tools.size).toBe(VOICE_TOOL_NAMES.length);
    expect(admin.agents.size).toBe(1);
  });

  it("reuses tools that already exist by name even without an agent id", async () => {
    const admin = createFakeElevenLabsAdmin();
    await setupVoiceAgent(admin);
    await setupVoiceAgent(admin);
    expect(admin.tools.size).toBe(VOICE_TOOL_NAMES.length);
    expect(admin.agents.size).toBe(2);
  });

  it("reports an unknown agent id as an error", async () => {
    expect(await setupVoiceAgent(createFakeElevenLabsAdmin(), { agentId: "agent_missing" })).toEqual({
      ok: false,
      error: { kind: "http", status: 404 },
    });
  });
});
