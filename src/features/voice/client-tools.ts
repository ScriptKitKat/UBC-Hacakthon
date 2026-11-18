import { z } from "zod";
import type { VoiceToolName } from "./tools";

export type VoiceToolForwarder = (name: VoiceToolName, parameters: unknown) => Promise<string>;

export type VoiceClientTools = Readonly<Record<VoiceToolName, (parameters: unknown) => Promise<string>>>;

export function createClientTools(forward: VoiceToolForwarder): VoiceClientTools {
  return {
    get_market_quote: (parameters) => forward("get_market_quote", parameters),
    propose_trade: (parameters) => forward("propose_trade", parameters),
    approve_pending_trade: (parameters) => forward("approve_pending_trade", parameters),
    get_desk_status: (parameters) => forward("get_desk_status", parameters),
  };
}


const spokenResult = z.object({ status: z.string(), say: z.string() });

export function readSpokenResult(rawResult: string): z.output<typeof spokenResult> | undefined {
  try {
    const parsed = spokenResult.safeParse(JSON.parse(rawResult));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
