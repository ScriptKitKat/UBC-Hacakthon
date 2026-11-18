import { describe, expect, it } from "vitest";
import { createFakeElevenLabsAdmin } from "./fake-admin";
import { loadVoiceEnv } from "./env";
import { openVoiceSession } from "./session";

describe("loadVoiceEnv", () => {
  it("defaults the operator to priscilla and treats blanks as missing", () => {
    expect(loadVoiceEnv({ ELEVENLABS_API_KEY: " ", VOICE_OPERATOR_ID: "" })).toEqual({
      operatorId: "priscilla",
      apiKey: undefined,
      agentId: undefined,
    });
    expect(loadVoiceEnv({ VOICE_OPERATOR_ID: "sam", ELEVENLABS_API_KEY: "k", ELEVENLABS_AGENT_ID: "a" })).toEqual({
      operatorId: "sam",
      apiKey: "k",
      agentId: "a",
    });
  });
});

describe("openVoiceSession", () => {
  it("lists every missing setting", async () => {
    const result = await openVoiceSession(loadVoiceEnv({}), () => createFakeElevenLabsAdmin());
    expect(result).toEqual({ ok: false, error: { kind: "not-configured", missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"] } });
    const keyOnly = await openVoiceSession(loadVoiceEnv({ ELEVENLABS_API_KEY: "k" }), () => createFakeElevenLabsAdmin());
    expect(keyOnly).toEqual({ ok: false, error: { kind: "not-configured", missing: ["ELEVENLABS_AGENT_ID"] } });
  });

  it("returns only the conversation token", async () => {
    const admin = createFakeElevenLabsAdmin();
    const created = await admin.createAgent({
      name: "n",
      conversation_config: { agent: { first_message: "", language: "en", prompt: { prompt: "", llm: "gpt-4.1", temperature: 0, tool_ids: [] } }, tts: { model_id: "eleven_flash_v2_5", voice_id: "v" } },
    });
    if (!created.ok) throw new Error("create failed");
    const env = loadVoiceEnv({ ELEVENLABS_API_KEY: "secret-key", ELEVENLABS_AGENT_ID: created.value.agentId });
    const result = await openVoiceSession(env, () => admin);
    expect(result).toEqual({ ok: true, value: { conversationToken: `token-for-${created.value.agentId}` } });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("surfaces upstream failures", async () => {
    const env = loadVoiceEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_AGENT_ID: "agent_missing" });
    expect(await openVoiceSession(env, () => createFakeElevenLabsAdmin())).toEqual({
      ok: false,
      error: { kind: "upstream", error: { kind: "http", status: 404 } },
    });
  });
});
