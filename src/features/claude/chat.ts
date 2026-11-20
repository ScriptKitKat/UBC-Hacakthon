import { z } from "zod";
import type { ClaudeSettings } from "./env";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 8000;

export interface ClaudeJsonRequest {
  readonly settings: ClaudeSettings;
  readonly fetch: typeof fetch;
  readonly system: string;
  readonly user: string;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
  readonly timeoutMs?: number;
}

const toolResponse = z.object({
  content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })),
});

export function toolInput(body: unknown, toolName: string): unknown {
  const parsed = toolResponse.safeParse(body);
  if (!parsed.success) return undefined;
  return parsed.data.content.find((block) => block.type === "tool_use" && block.name === toolName)?.input;
}

export function buildClaudeBody(request: Omit<ClaudeJsonRequest, "fetch" | "timeoutMs">) {
  return {
    model: request.settings.model,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    tools: [{ name: request.schemaName, description: "Return the answer in exactly this shape.", input_schema: request.schema }],
    tool_choice: { type: "tool", name: request.schemaName },
  };
}

export async function requestClaudeJson(request: ClaudeJsonRequest): Promise<unknown> {
  const { apiKey } = request.settings;
  if (apiKey === undefined) return undefined;
  try {
    const response = await request.fetch(MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify(buildClaudeBody(request)),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return response.ok ? toolInput(await response.json(), request.schemaName) : undefined;
  } catch {
    return undefined;
  }
}
