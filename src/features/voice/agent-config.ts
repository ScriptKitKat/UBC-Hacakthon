import { z } from "zod";
import type { AgentConfig, ClientToolConfig, ToolParameters } from "./elevenlabs-types";
import { voiceToolDescriptions, voiceToolSchemas } from "./tools";
import type { VoiceToolName } from "./tools";

const TOOL_RESPONSE_TIMEOUT_SECS = 60;
const DEFAULT_VOICE_ID = "cjVigY5qzO86Huf0OWal";

export const AGENT_NAME = "News-to-Trade Desk";

export const FIRST_MESSAGE = "Desk is live. Ask me what the market is saying, and I'll pull the odds and the news behind them.";

export const SYSTEM_PROMPT = `You are the voice of a small paper-trading desk. You help one trader react to breaking news using Gemini prediction-market odds. Speak in short, plain sentences, because everything you say is read aloud.

Rules you never break:
- Always call get_market_quote before discussing odds, news, or budget. Never invent prices, headlines, or balances; only use numbers returned by tools.
- If get_market_quote says nothing matched, say so plainly and stop. Do not guess a market.
- After quoting the market, you may suggest one trade with a side and a dollar amount, for example "I'd put 2 dollars on yes, want me to?".
- Always ask for explicit confirmation of the side and the dollar amount before calling propose_trade. A question, a maybe, or silence is not confirmation.
- If propose_trade or approve_pending_trade reports that a trade is waiting for approval, tell the trader and ask whether to approve it. Only call approve_pending_trade after they clearly say yes.
- When any tool returns a refusal, read its "say" field out loud verbatim, word for word. Do not soften, paraphrase, or work around a refusal, and never retry a refused trade with a different amount unless the trader asks.
- For every tool result, the "say" field is what you tell the trader. Add nothing that contradicts it.
- Use get_desk_status when asked about spending, remaining budget, pending trades, or the kill switch.`;

const propertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().min(1),
  enum: z.array(z.string()).optional(),
});

const objectSchema = z.object({
  properties: z.record(z.string(), propertySchema),
  required: z.array(z.string()).optional(),
});

function toolParameters(name: VoiceToolName): ToolParameters | undefined {
  const { properties, required } = objectSchema.parse(z.toJSONSchema(voiceToolSchemas[name], { io: "input" }));
  if (Object.keys(properties).length === 0) return undefined;
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, property]) => [
        key,
        { type: property.type, description: property.description, ...(property.enum ? { enum: property.enum } : {}) },
      ]),
    ),
    ...(required ? { required } : {}),
  };
}

export function clientToolConfig(name: VoiceToolName): ClientToolConfig {
  const parameters = toolParameters(name);
  return {
    type: "client",
    name,
    description: voiceToolDescriptions[name],
    expects_response: true,
    response_timeout_secs: TOOL_RESPONSE_TIMEOUT_SECS,
    ...(parameters ? { parameters } : {}),
  };
}

export const clientToolConfigs = {
  get_market_quote: clientToolConfig("get_market_quote"),
  propose_trade: clientToolConfig("propose_trade"),
  approve_pending_trade: clientToolConfig("approve_pending_trade"),
  get_desk_status: clientToolConfig("get_desk_status"),
} satisfies Record<VoiceToolName, ClientToolConfig>;

export function buildAgentConfig(toolIds: readonly string[], voiceId: string = DEFAULT_VOICE_ID): AgentConfig {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: { prompt: SYSTEM_PROMPT, llm: "gpt-4.1", temperature: 0.2, tool_ids: toolIds },
      },
      tts: { model_id: "eleven_flash_v2_5", voice_id: voiceId },
    },
  };
}
