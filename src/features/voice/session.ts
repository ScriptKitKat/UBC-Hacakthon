import { z } from "zod";
import { fail, ok } from "@/features/markets";
import type { Result } from "@/features/markets";
import type { AdminError } from "./elevenlabs-types";
import type { ElevenLabsAdmin } from "./admin-client";
import { missingSessionSettings } from "./env";
import type { VoiceEnv } from "./env";

export const voiceSessionResponse = z.object({ conversationToken: z.string().min(1) });

export type VoiceSessionResponse = z.output<typeof voiceSessionResponse>;

export type VoiceSessionError =
  | { readonly kind: "not-configured"; readonly missing: readonly string[] }
  | { readonly kind: "upstream"; readonly error: AdminError };

export async function openVoiceSession(
  env: VoiceEnv,
  createAdmin: (apiKey: string) => ElevenLabsAdmin,
): Promise<Result<VoiceSessionResponse, VoiceSessionError>> {
  const { apiKey, agentId } = env;
  if (apiKey === undefined || agentId === undefined) return fail({ kind: "not-configured", missing: missingSessionSettings(env) });
  const token = await createAdmin(apiKey).getConversationToken(agentId);
  return token.ok ? ok({ conversationToken: token.value }) : fail({ kind: "upstream", error: token.error });
}
