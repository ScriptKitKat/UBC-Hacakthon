import { describe, expect, it } from "vitest";
import { createElevenLabsAdmin } from "./admin-client";
import { buildAgentConfig, clientToolConfigs } from "./agent-config";

const API_KEY = "sk_super_secret_key_123";

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) return input.href;
  return input instanceof Request ? input.url : input;
}

function adminWith(respond: (url: string) => Response) {
  const calls: RecordedCall[] = [];
  const recordingFetch: typeof fetch = (input, init) => {
    const url = urlOf(input);
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(respond(url));
  };
  return { admin: createElevenLabsAdmin({ apiKey: API_KEY, fetch: recordingFetch }), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const toolBody = (id: string, name: string) => ({ id, tool_config: { name, type: "client" } });

describe("elevenlabs admin client", () => {
  it("sends the key as xi-api-key and posts the tool config", async () => {
    const { admin, calls } = adminWith(() => json(toolBody("tool_1", "propose_trade")));
    const result = await admin.createTool(clientToolConfigs.propose_trade);
    expect(result).toEqual({ ok: true, value: { id: "tool_1", name: "propose_trade" } });
    const [call] = calls;
    expect(call?.url).toBe("https://api.elevenlabs.io/v1/convai/tools");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toMatchObject({ "xi-api-key": API_KEY });
    expect(JSON.parse(typeof call?.init.body === "string" ? call.init.body : "")).toEqual({ tool_config: clientToolConfigs.propose_trade });
  });

  it("patches tools and agents by id", async () => {
    const { admin, calls } = adminWith((url) => (url.includes("/tools/") ? json(toolBody("t/1", "x")) : json({ agent_id: "agent_9" })));
    await admin.updateTool("t/1", clientToolConfigs.propose_trade);
    const updated = await admin.updateAgent("agent_9", buildAgentConfig(["t"]));
    expect(updated).toEqual({ ok: true, value: { agentId: "agent_9" } });
    expect(calls.map(({ url, init }) => `${init.method ?? ""} ${url}`)).toEqual([
      "PATCH https://api.elevenlabs.io/v1/convai/tools/t%2F1",
      "PATCH https://api.elevenlabs.io/v1/convai/agents/agent_9",
    ]);
  });

  it("creates agents at the create endpoint", async () => {
    const { admin, calls } = adminWith(() => json({ agent_id: "agent_1" }));
    expect(await admin.createAgent(buildAgentConfig(["t"]))).toEqual({ ok: true, value: { agentId: "agent_1" } });
    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/convai/agents/create");
  });

  it("follows pagination when listing tools", async () => {
    const { admin, calls } = adminWith((url) =>
      url.includes("cursor=c2")
        ? json({ tools: [toolBody("b", "two")], has_more: false })
        : json({ tools: [toolBody("a", "one")], has_more: true, next_cursor: "c2" }),
    );
    expect(await admin.listTools()).toEqual({
      ok: true,
      value: [{ id: "a", name: "one" }, { id: "b", name: "two" }],
    });
    expect(calls).toHaveLength(2);
  });

  it("fetches the webrtc conversation token and the signed url", async () => {
    const { admin, calls } = adminWith((url) => (url.includes("/token") ? json({ token: "tok" }) : json({ signed_url: "wss://x" })));
    expect(await admin.getConversationToken("agent_1")).toEqual({ ok: true, value: "tok" });
    expect(await admin.getSignedUrl("agent_1")).toEqual({ ok: true, value: "wss://x" });
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_1",
      "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_1",
    ]);
  });

  it("reports http, network and parse failures without leaking the key or upstream text", async () => {
    const http = adminWith(() => json({ detail: `bad key ${API_KEY}` }, 401));
    const network = createElevenLabsAdmin({ apiKey: API_KEY, fetch: () => Promise.reject(new Error(`boom ${API_KEY}`)) });
    const malformed = adminWith(() => json({ unexpected: true }));
    const notJson = adminWith(() => new Response("<html>", { status: 200 }));
    const results = [
      await http.admin.listTools(),
      await network.getSignedUrl("agent_1"),
      await malformed.admin.getConversationToken("agent_1"),
      await notJson.admin.getConversationToken("agent_1"),
    ];
    expect(results).toEqual([
      { ok: false, error: { kind: "http", status: 401 } },
      { ok: false, error: { kind: "network" } },
      { ok: false, error: { kind: "parse" } },
      { ok: false, error: { kind: "parse" } },
    ]);
    expect(JSON.stringify(results)).not.toContain(API_KEY);
    expect(JSON.stringify(Object.values(http.admin))).not.toContain(API_KEY);
  });
});
