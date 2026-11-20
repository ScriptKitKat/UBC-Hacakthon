import { describe, expect, it, vi } from "vitest";
import { requestClaudeJson } from "./chat";
import { DEFAULT_CLAUDE_MODEL, loadClaudeSettings } from "./env";

const settings = { apiKey: "test-key", model: "claude-test" };
const request = { settings, system: "sys", user: "usr", schemaName: "thing", schema: { type: "object" } };

function reply(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
}

describe("requestClaudeJson", () => {
  it("forces the schema as a tool and returns the tool input", async () => {
    const fake = reply({ content: [{ type: "text", text: "ignored" }, { type: "tool_use", name: "thing", input: { ok: true } }] });
    expect(await requestClaudeJson({ ...request, fetch: fake })).toEqual({ ok: true });
    const [url, init] = fake.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toMatchObject({
      model: "claude-test",
      temperature: 0,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
      tools: [{ name: "thing", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "thing" },
    });
  });

  it("returns nothing without an API key and never calls the network", async () => {
    const fake = reply({});
    expect(await requestClaudeJson({ ...request, settings: { apiKey: undefined, model: "m" }, fetch: fake })).toBeUndefined();
    expect(fake).not.toHaveBeenCalled();
  });

  it("returns nothing on an error status, a missing tool call, or a network failure", async () => {
    expect(await requestClaudeJson({ ...request, fetch: reply({ error: { type: "authentication_error" } }, 401) })).toBeUndefined();
    expect(await requestClaudeJson({ ...request, fetch: reply({ content: [{ type: "tool_use", name: "other", input: {} }] }) })).toBeUndefined();
    expect(await requestClaudeJson({ ...request, fetch: vi.fn<typeof fetch>(() => Promise.reject(new Error("down"))) })).toBeUndefined();
  });
});

describe("loadClaudeSettings", () => {
  it("defaults the model and treats a blank key as absent", () => {
    expect(loadClaudeSettings({ ANTHROPIC_API_KEY: " ", ANTHROPIC_MODEL: "" })).toEqual({ apiKey: undefined, model: DEFAULT_CLAUDE_MODEL });
    expect(loadClaudeSettings({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" })).toEqual({ apiKey: "k", model: "m" });
  });
});
