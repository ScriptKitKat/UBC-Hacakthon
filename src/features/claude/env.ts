import { z } from "zod";

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

const present = z.string().trim().min(1);

const claudeEnv = z.object({
  ANTHROPIC_API_KEY: present.optional(),
  ANTHROPIC_MODEL: present.default(DEFAULT_CLAUDE_MODEL),
});

export interface ClaudeSettings {
  readonly apiKey: string | undefined;
  readonly model: string;
}

export function loadClaudeSettings(env: Readonly<Record<string, string | undefined>>): ClaudeSettings {
  const parsed = claudeEnv.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim() !== "")));
  return { apiKey: parsed.ANTHROPIC_API_KEY, model: parsed.ANTHROPIC_MODEL };
}
