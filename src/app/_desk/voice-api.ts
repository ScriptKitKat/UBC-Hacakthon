import { voiceSessionResponse } from "@/features/voice";
import type { VoiceToolName } from "@/features/voice";
import { z } from "zod";

export type VoiceSessionResult =
  | { readonly kind: "ready"; readonly conversationToken: string }
  | { readonly kind: "not-configured"; readonly missing: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

const notConfigured = z.object({ missing: z.array(z.string()) });

const DESK_UNREACHABLE = JSON.stringify({ status: "unavailable", say: "I couldn't reach the desk right now." });

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function loadVoiceSession(): Promise<VoiceSessionResult> {
  try {
    const response = await fetch("/api/voice/session", { cache: "no-store" });
    const body = await readJson(response);
    if (response.status === 503) {
      const parsed = notConfigured.safeParse(body);
      return { kind: "not-configured", missing: parsed.success ? parsed.data.missing : [] };
    }
    const session = voiceSessionResponse.safeParse(body);
    if (!response.ok || !session.success) return { kind: "error", message: `Voice session failed with HTTP ${String(response.status)}` };
    return { kind: "ready", conversationToken: session.data.conversationToken };
  } catch {
    return { kind: "error", message: "Could not reach the voice session endpoint" };
  }
}

export async function callVoiceTool(name: VoiceToolName, parameters: unknown): Promise<string> {
  try {
    const response = await fetch(`/api/voice/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parameters ?? {}),
    });
    return await response.text();
  } catch {
    return DESK_UNREACHABLE;
  }
}
