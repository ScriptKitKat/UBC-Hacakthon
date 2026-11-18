import { z } from "zod";

const DEFAULT_OPERATOR_ID = "priscilla";

const present = z.string().trim().min(1);

const voiceEnv = z.object({
  VOICE_OPERATOR_ID: present.default(DEFAULT_OPERATOR_ID),
  ELEVENLABS_API_KEY: present.optional(),
  ELEVENLABS_AGENT_ID: present.optional(),
});

export interface VoiceEnv {
  readonly operatorId: string;
  readonly apiKey: string | undefined;
  readonly agentId: string | undefined;
}

export function loadVoiceEnv(env: Readonly<Record<string, string | undefined>>): VoiceEnv {
  const parsed = voiceEnv.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim() !== "")));
  return { operatorId: parsed.VOICE_OPERATOR_ID, apiKey: parsed.ELEVENLABS_API_KEY, agentId: parsed.ELEVENLABS_AGENT_ID };
}

export function missingSessionSettings(env: VoiceEnv): readonly string[] {
  return [
    ...(env.apiKey === undefined ? ["ELEVENLABS_API_KEY"] : []),
    ...(env.agentId === undefined ? ["ELEVENLABS_AGENT_ID"] : []),
  ];
}
