import { describe, expect, it, vi } from "vitest";
import { selectLlm } from "./index";

const request = { system: "sys", user: "usr", schemaName: "answer", schema: { type: "object" } };

describe("selectLlm", () => {
  it("prefers Grok when both providers have keys", () => {
    const selected = selectLlm({
      grok: { apiKey: "grok-key", model: "grok-test" },
      claude: { apiKey: "claude-key", model: "claude-test" },
      fetch: vi.fn<typeof fetch>(),
    });
    expect(selected?.provider).toBe("grok");
  });

  it("selects Claude when only Claude has a key", async () => {
    const fakeFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({
      content: [{ type: "tool_use", name: "answer", input: { ok: true } }],
    })));
    const selected = selectLlm({
      grok: { apiKey: undefined, model: "grok-test" },
      claude: { apiKey: "claude-key", model: "claude-test" },
      fetch: fakeFetch,
    });
    expect(selected?.provider).toBe("claude");
    await expect(selected?.complete(request)).resolves.toEqual({ ok: true });
    expect(fakeFetch.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("returns undefined when neither provider has a key", () => {
    expect(selectLlm({
      grok: { apiKey: undefined, model: "grok-test" },
      claude: { apiKey: undefined, model: "claude-test" },
      fetch: vi.fn<typeof fetch>(),
    })).toBeUndefined();
  });

  it("passes a custom timeout to the selected provider", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const fakeFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
    })));
    const selected = selectLlm({
      grok: { apiKey: "grok-key", model: "grok-test" },
      claude: { apiKey: undefined, model: "claude-test" },
      fetch: fakeFetch,
    });
    await selected?.complete({ ...request, timeoutMs: 1500 });
    expect(timeout).toHaveBeenCalledWith(1500);
    timeout.mockRestore();
  });
});
