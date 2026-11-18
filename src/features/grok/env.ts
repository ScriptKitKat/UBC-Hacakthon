import { z } from "zod";

export const DEFAULT_GROK_MODEL = "grok-4.20-0309-non-reasoning";

const present = z.string().trim().min(1);

const grokEnv = z.object({
  XAI_API_KEY: present.optional(),
  XAI_MODEL: present.default(DEFAULT_GROK_MODEL),
});

export interface GrokSettings {
  readonly apiKey: string | undefined;
  readonly model: string;
}

export function loadGrokSettings(env: Readonly<Record<string, string | undefined>>): GrokSettings {
  const parsed = grokEnv.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim() !== "")));
  return { apiKey: parsed.XAI_API_KEY, model: parsed.XAI_MODEL };
}
