import { fail, ok } from "@/features/markets";
import type { AdminResult, ElevenLabsAdmin } from "./admin-client";
import { buildAgentConfig, clientToolConfigs } from "./agent-config";
import type { ToolSummary } from "./elevenlabs-types";
import { VOICE_TOOL_NAMES } from "./tools";

export interface VoiceSetup {
  readonly agentId: string;
  readonly agentCreated: boolean;
  readonly tools: readonly ToolSummary[];
}

export interface VoiceSetupOptions {
  readonly agentId?: string;
}

async function upsertTools(admin: ElevenLabsAdmin): Promise<AdminResult<readonly ToolSummary[]>> {
  const existing = await admin.listTools();
  if (!existing.ok) return existing;
  const idsByName = new Map(existing.value.map((tool) => [tool.name, tool.id]));
  const saved: ToolSummary[] = [];
  for (const name of VOICE_TOOL_NAMES) {
    const knownId = idsByName.get(name);
    const config = clientToolConfigs[name];
    const result = knownId === undefined ? await admin.createTool(config) : await admin.updateTool(knownId, config);
    if (!result.ok) return result;
    saved.push(result.value);
  }
  return ok(saved);
}

export async function setupVoiceAgent(admin: ElevenLabsAdmin, options: VoiceSetupOptions = {}): Promise<AdminResult<VoiceSetup>> {
  const tools = await upsertTools(admin);
  if (!tools.ok) return tools;
  const config = buildAgentConfig(tools.value.map((tool) => tool.id));
  const agent = options.agentId === undefined ? await admin.createAgent(config) : await admin.updateAgent(options.agentId, config);
  if (!agent.ok) return fail(agent.error);
  return ok({ agentId: agent.value.agentId, agentCreated: options.agentId === undefined, tools: tools.value });
}
