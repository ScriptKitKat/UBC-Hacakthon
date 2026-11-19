import { describe, expect, it, vi } from "vitest";
import { requestGrokJson } from "./chat";

const settings = { apiKey: "test-key", model: "grok-test" };
const request = { settings, system: "sys", user: "usr", schemaName: "thing", schema: { type: "object" } };

function reply(content: string) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ choices: [{ message: { content } }] })));
}

describe("requestGrokJson", () => {
  it("posts a temperature-0 strict JSON-schema request and returns the parsed content", async () => {
    const fake = reply('{"ok":true}');
    expect(await requestGrokJson({ ...request, fetch: fake })).toEqual({ ok: true });
    const [url, init] = fake.mock.calls[0] ?? [];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toMatchObject({
      model: "grok-test",
      temperature: 0,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }],
      response_format: { type: "json_schema", json_schema: { name: "thing", strict: true, schema: { type: "object" } } },
    });
  });

  it("returns nothing without an API key and never calls the network", async () => {
    const fake = reply("{}");
    expect(await requestGrokJson({ ...request, settings: { apiKey: undefined, model: "m" }, fetch: fake })).toBeUndefined();
    expect(fake).not.toHaveBeenCalled();
  });

  it("returns nothing for HTTP errors, thrown fetches and non-JSON content", async () => {
    expect(await requestGrokJson({ ...request, fetch: vi.fn(() => Promise.resolve(new Response("no", { status: 500 }))) })).toBeUndefined();
    expect(await requestGrokJson({ ...request, fetch: vi.fn(() => Promise.reject(new Error("offline"))) })).toBeUndefined();
    expect(await requestGrokJson({ ...request, fetch: reply("not json") })).toBeUndefined();
  });
});
