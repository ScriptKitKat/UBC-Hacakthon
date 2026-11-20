import { requestGrokJson, type GrokSettings } from "@/features/grok";
import { formatPercent } from "@/shared";
import type { MarketSnapshot, TriggerResult } from "./triggers";
import { hoursToExpiry, volumeMultiple } from "./triggers";
import { PERSONALITY_COPY, type AgentRecord, type MessageSource, type TriggerId } from "./types";

const MESSAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

function triggerLine(id: TriggerId, result: TriggerResult, snapshot: MarketSnapshot, now: Date): string {
  const points = result.todayPoints;
  switch (id) {
    case "oddsMove":
    case "briefOddsMove10":
      return points === null ? "The Yes price moved enough to notice." : `Yes moved ${points > 0 ? "up" : "down"} ${String(Math.abs(points))} points to ${formatPercent(snapshot.yesCents)}.`;
    case "volumeSpike": {
      const multiple = volumeMultiple(snapshot, now);
      return multiple === null ? "Volume looks unusual versus this market's own history." : `Volume is at ${multiple.toFixed(1)}x the typical daily pace.`;
    }
    case "oddsCross":
      return `Yes crossed the level this agent watches and is now ${formatPercent(snapshot.yesCents)}.`;
    case "endingSoon":
    case "briefEndingSoon": {
      const hours = hoursToExpiry(snapshot, now);
      return hours === null ? "This market is close to ending." : `This market ends in about ${String(Math.max(1, Math.round(hours)))} hours.`;
    }
    case "briefMonday":
      return "It's Monday, so this agent is due to write a brief.";
    case "xMentions": {
      const counts = result.x?.counts;
      if (counts === undefined) return "X mentions were unusually high.";
      const multiple = counts.lastHourCount / Math.max(counts.baselineHourlyCount, 1);
      return `Posts about this on X jumped to ${String(counts.lastHourCount)} in the last hour, about ${multiple.toFixed(1)}× the usual rate.`;
    }
    case "breakingNews": {
      const post = result.x?.breakingPost;
      return post === undefined || post === null
        ? "Breaking news was reported on X."
        : `Breaking on X from @${post.authorUsername}: “${post.text.slice(0, 140)}”.`;
    }
    default:
      return "Something worth a look happened.";
  }
}

export function templateMessage(agent: AgentRecord, result: TriggerResult, snapshot: MarketSnapshot, now: Date): string {
  const facts = result.fired.map((id) => triggerLine(id, result, snapshot, now)).join(" ");
  switch (agent.personality) {
    case "calm":
      return `${agent.name}: ${facts} Risk first: I would wait for the next print before changing a position.`;
    case "contrarian":
      return `${agent.name}: ${facts} The crowd already priced this in; I would not chase it.`;
    case "momentum":
      return `${agent.name}: ${facts} I'll only lean in if volume keeps confirming the move.`;
    case "coach":
      return `${agent.name}: ${facts} In short, something real changed in this market, and it is worth a look.`;
  }
}

export async function composeMessage(options: {
  readonly agent: AgentRecord;
  readonly result: TriggerResult;
  readonly snapshot: MarketSnapshot;
  readonly now: Date;
  readonly grok: GrokSettings;
  readonly fetch: typeof fetch;
}): Promise<{ readonly text: string; readonly source: MessageSource }> {
  const fallback = templateMessage(options.agent, options.result, options.snapshot, options.now);
  if (options.agent.model !== "grok" || options.grok.apiKey === undefined) return { text: fallback, source: "template" };
  const facts = options.result.fired.map((id) => triggerLine(id, options.result, options.snapshot, options.now)).join(" ");
  const custom = options.agent.instructions.trim();
  const body = await requestGrokJson({
    settings: options.grok,
    fetch: options.fetch,
    schemaName: "agent_message",
    schema: MESSAGE_SCHEMA,
    system: `You are ${options.agent.name}, a prediction-market desk agent. ${PERSONALITY_COPY[options.agent.personality].voice} Write 2-4 short sentences. Do not invent prices, volume, or news that were not provided. Do not claim you placed a bet.`,
    user: `Market facts:\n${facts}\nCurrent Yes: ${formatPercent(options.snapshot.yesCents)}\n${custom === "" ? "" : `Extra instructions from the user: ${custom}`}`,
  });
  const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message.trim() : "";
  if (message === "") return { text: fallback, source: "template" };
  return { text: message, source: "llm" };
}
