import { z } from "zod";
import type { PostCandidate, PostInput } from "./types";

export const MAX_WHY_LENGTH = 110;
const MAX_POST_CHARS = 700;

const SYSTEM_PROMPT = [
  "You connect a post from X to the single most relevant live prediction market.",
  "Choose a market only when the post is news that clearly moves that market's outcome.",
  "pick.instrumentSymbol must be copied verbatim from the candidate list; otherwise set pick to null.",
  "confidence is 0 to 1: how sure you are that this market is directly affected by the post.",
  `why is one plain sentence of at most ${String(MAX_WHY_LENGTH)} characters saying why this post moves this market. No hype, no emoji, no advice.`,
].join(" ");

export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pick", "confidence", "why"],
  properties: {
    pick: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["instrumentSymbol"],
          properties: { instrumentSymbol: { type: "string" } },
        },
        { type: "null" },
      ],
    },
    confidence: { type: "number" },
    why: { type: "string" },
  },
} as const;

export const grokAnswer = z.object({
  pick: z.object({ instrumentSymbol: z.string() }).nullable(),
  confidence: z.number().min(0).max(1),
  why: z.string(),
});

export type GrokAnswer = z.output<typeof grokAnswer>;

function candidateLine(candidate: PostCandidate): string {
  const { contract } = candidate;
  return `${contract.instrumentSymbol} | ${candidate.eventTitle} | ${contract.label} | ${String(contract.prices.buyYesCents ?? "?")}c`;
}

export function buildRequestBody(model: string, post: PostInput, candidates: readonly PostCandidate[]) {
  const author = post.author ? ` by ${post.author}` : "";
  const user = [
    `Post${author}:`,
    post.text.slice(0, MAX_POST_CHARS),
    "",
    "Candidate markets (instrumentSymbol | event | contract | yes price):",
    ...candidates.map(candidateLine),
  ].join("\n");
  return {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: "post_market_pick", strict: true, schema: RESPONSE_SCHEMA } },
  };
}

const completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

export function parseCompletion(body: unknown): GrokAnswer | undefined {
  const parsed = completion.safeParse(body);
  const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
  if (content === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return undefined;
  }
  const answer = grokAnswer.safeParse(json);
  return answer.success ? answer.data : undefined;
}

export function trimWhy(why: string): string {
  const plain = why.replace(/\s+/gu, " ").trim();
  return plain.length <= MAX_WHY_LENGTH ? plain : `${plain.slice(0, MAX_WHY_LENGTH - 1).trimEnd()}…`;
}
