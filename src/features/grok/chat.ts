import type { GrokSettings } from "./env";
import { completionJson } from "./request";

const GROK_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8000;

export interface GrokChatRequest {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly body: unknown;
  readonly timeoutMs?: number;
}

export async function postGrokChat(request: GrokChatRequest): Promise<unknown> {
  try {
    const response = await request.fetch(GROK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

export interface GrokJsonRequest {
  readonly settings: GrokSettings;
  readonly fetch: typeof fetch;
  readonly system: string;
  readonly user: string;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
}

export async function requestGrokJson(request: GrokJsonRequest): Promise<unknown> {
  const { settings } = request;
  if (settings.apiKey === undefined) return undefined;
  const body = await postGrokChat({
    apiKey: settings.apiKey,
    fetch: request.fetch,
    body: {
      model: settings.model,
      temperature: 0,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
    },
  });
  return body === undefined ? undefined : completionJson(body);
}
