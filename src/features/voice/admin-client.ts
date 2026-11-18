import { z } from "zod";
import { fail, ok } from "@/features/markets";
import type { Result } from "@/features/markets";
import type { AdminError, AgentConfig, ClientToolConfig, ToolSummary } from "./elevenlabs-types";

export type AdminResult<T> = Result<T, AdminError>;

export interface ElevenLabsAdmin {
  readonly listTools: () => Promise<AdminResult<readonly ToolSummary[]>>;
  readonly createTool: (config: ClientToolConfig) => Promise<AdminResult<ToolSummary>>;
  readonly updateTool: (toolId: string, config: ClientToolConfig) => Promise<AdminResult<ToolSummary>>;
  readonly createAgent: (config: AgentConfig) => Promise<AdminResult<{ readonly agentId: string }>>;
  readonly updateAgent: (agentId: string, config: AgentConfig) => Promise<AdminResult<{ readonly agentId: string }>>;
  readonly getConversationToken: (agentId: string) => Promise<AdminResult<string>>;
  readonly getSignedUrl: (agentId: string) => Promise<AdminResult<string>>;
}

export interface ElevenLabsAdminOptions {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const TOOLS_PAGE_SIZE = 100;

const toolResponse = z.object({ id: z.string(), tool_config: z.object({ name: z.string() }) });
const toolsPage = z.object({
  tools: z.array(toolResponse),
  has_more: z.boolean(),
  next_cursor: z.string().nullish(),
});
const agentCreated = z.object({ agent_id: z.string() });
const conversationToken = z.object({ token: z.string() });
const signedUrl = z.object({ signed_url: z.string() });

function summary(tool: z.output<typeof toolResponse>): ToolSummary {
  return { id: tool.id, name: tool.tool_config.name };
}

export function createElevenLabsAdmin(options: ElevenLabsAdminOptions): ElevenLabsAdmin {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  async function request<S extends z.ZodType>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<AdminResult<z.output<S>>> {
    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "xi-api-key": options.apiKey,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return fail({ kind: "network" });
    }
    if (!response.ok) return fail({ kind: "http", status: response.status });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return fail({ kind: "parse" });
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? ok(parsed.data) : fail({ kind: "parse" });
  }

  async function listTools(): Promise<AdminResult<readonly ToolSummary[]>> {
    const tools: ToolSummary[] = [];
    let cursor: string | null | undefined;
    do {
      const query = new URLSearchParams({ page_size: String(TOOLS_PAGE_SIZE), ...(cursor ? { cursor } : {}) });
      const page = await request("GET", `/v1/convai/tools?${query.toString()}`, toolsPage);
      if (!page.ok) return page;
      tools.push(...page.value.tools.map(summary));
      cursor = page.value.has_more ? page.value.next_cursor : undefined;
    } while (cursor);
    return ok(tools);
  }

  function agentResult(result: AdminResult<z.output<typeof agentCreated>>) {
    return result.ok ? ok({ agentId: result.value.agent_id }) : result;
  }

  const agentQuery = (agentId: string) => new URLSearchParams({ agent_id: agentId }).toString();

  return {
    listTools,
    async createTool(config) {
      const created = await request("POST", "/v1/convai/tools", toolResponse, { tool_config: config });
      return created.ok ? ok(summary(created.value)) : created;
    },
    async updateTool(toolId, config) {
      const updated = await request("PATCH", `/v1/convai/tools/${encodeURIComponent(toolId)}`, toolResponse, { tool_config: config });
      return updated.ok ? ok(summary(updated.value)) : updated;
    },
    async createAgent(config) {
      return agentResult(await request("POST", "/v1/convai/agents/create", agentCreated, config));
    },
    async updateAgent(agentId, config) {
      return agentResult(await request("PATCH", `/v1/convai/agents/${encodeURIComponent(agentId)}`, agentCreated, config));
    },
    async getConversationToken(agentId) {
      const result = await request("GET", `/v1/convai/conversation/token?${agentQuery(agentId)}`, conversationToken);
      return result.ok ? ok(result.value.token) : result;
    },
    async getSignedUrl(agentId) {
      const result = await request("GET", `/v1/convai/conversation/get-signed-url?${agentQuery(agentId)}`, signedUrl);
      return result.ok ? ok(result.value.signed_url) : result;
    },
  };
}
