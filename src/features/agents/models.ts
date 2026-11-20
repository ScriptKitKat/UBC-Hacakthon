import type { AgentModel } from "./types";

export type ModelAvailability = Readonly<Record<AgentModel, { readonly available: boolean; readonly reason: string | null }>>;

export function modelAvailability(env: Readonly<Record<string, string | undefined>> = process.env): ModelAvailability {
  const grokKey = env.XAI_API_KEY?.trim();
  return {
    grok: grokKey ? { available: true, reason: null } : { available: false, reason: "not configured" },
    claude: { available: false, reason: "not configured" },
    other: { available: false, reason: "not configured" },
  };
}
