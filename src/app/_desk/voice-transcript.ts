import type { VoiceToolName } from "@/features/voice";

export type TranscriptEntry =
  | { readonly id: number; readonly kind: "user" | "agent"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "tool";
      readonly tool: VoiceToolName;
      readonly parameters: string;
      readonly status: string;
      readonly say: string;
    }
  | { readonly id: number; readonly kind: "notice"; readonly text: string };

export type NewTranscriptEntry = TranscriptEntry extends infer Entry ? (Entry extends unknown ? Omit<Entry, "id"> : never) : never;

export function describeParameters(parameters: unknown): string {
  if (typeof parameters !== "object" || parameters === null) return "";
  const pairs = Object.entries(parameters).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return pairs.join(" ");
}
