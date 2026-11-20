import { requestClaudeJson } from "@/features/claude";
import type { ClaudeSettings } from "@/features/claude";
import { requestGrokJson } from "@/features/grok";
import type { GrokSettings } from "@/features/grok";

export interface JsonRequest {
  readonly system: string;
  readonly user: string;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
  readonly timeoutMs?: number;
}

export type JsonCompleter = (request: JsonRequest) => Promise<unknown>;

export type LlmProvider = "grok" | "claude";

export interface LlmCompleter {
  readonly provider: LlmProvider;
  readonly complete: JsonCompleter;
}

export function selectLlm(deps: {
  readonly grok: GrokSettings;
  readonly claude: ClaudeSettings;
  readonly fetch: typeof fetch;
}): LlmCompleter | undefined {
  if (deps.grok.apiKey !== undefined) {
    return {
      provider: "grok",
      complete: (request) => requestGrokJson({ settings: deps.grok, fetch: deps.fetch, ...request }),
    };
  }
  if (deps.claude.apiKey !== undefined) {
    return {
      provider: "claude",
      complete: (request) => requestClaudeJson({ settings: deps.claude, fetch: deps.fetch, ...request }),
    };
  }
  return undefined;
}
