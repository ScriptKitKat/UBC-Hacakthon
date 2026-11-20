import type { AgentModel } from "./types";

export type ModelAvailability = Readonly<Record<AgentModel, { readonly available: boolean; readonly reason: string | null }>>;

export function modelAvailability(env: Readonly<Record<string, string | undefined>> = process.env): ModelAvailability {
  const configured = (key: string | undefined) => (key?.trim() ? { available: true, reason: null } : { available: false, reason: "not configured" });
  return {
    grok: configured(env.XAI_API_KEY),
    claude: configured(env.ANTHROPIC_API_KEY),
    other: { available: false, reason: "not configured" },
  };
}

export function preferredModel(models: ModelAvailability): AgentModel {
  if (!models.grok.available && models.claude.available) return "claude";
  return "grok";
}
