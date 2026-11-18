import { fail, ok } from "@/features/markets";
import type { ElevenLabsAdmin } from "./admin-client";
import type { AgentConfig, ClientToolConfig } from "./elevenlabs-types";

export interface FakeElevenLabsAdmin extends ElevenLabsAdmin {
  readonly tools: ReadonlyMap<string, ClientToolConfig>;
  readonly agents: ReadonlyMap<string, AgentConfig>;
}

export function createFakeElevenLabsAdmin(): FakeElevenLabsAdmin {
  const tools = new Map<string, ClientToolConfig>();
  const agents = new Map<string, AgentConfig>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_fake${String(++sequence)}`;

  return {
    tools,
    agents,
    listTools: () => Promise.resolve(ok([...tools].map(([id, config]) => ({ id, name: config.name })))),
    createTool(config) {
      const id = nextId("tool");
      tools.set(id, config);
      return Promise.resolve(ok({ id, name: config.name }));
    },
    updateTool(toolId, config) {
      if (!tools.has(toolId)) return Promise.resolve(fail({ kind: "http", status: 404 }));
      tools.set(toolId, config);
      return Promise.resolve(ok({ id: toolId, name: config.name }));
    },
    createAgent(config) {
      const agentId = nextId("agent");
      agents.set(agentId, config);
      return Promise.resolve(ok({ agentId }));
    },
    updateAgent(agentId, config) {
      if (!agents.has(agentId)) return Promise.resolve(fail({ kind: "http", status: 404 }));
      agents.set(agentId, config);
      return Promise.resolve(ok({ agentId }));
    },
    getConversationToken(agentId) {
      return Promise.resolve(agents.has(agentId) ? ok(`token-for-${agentId}`) : fail({ kind: "http", status: 404 }));
    },
    getSignedUrl(agentId) {
      return Promise.resolve(agents.has(agentId) ? ok(`wss://fake.test/${agentId}`) : fail({ kind: "http", status: 404 }));
    },
  };
}
