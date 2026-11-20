export const BRIEF_COST_CENTS = 5;
export const ODDS_MOVE_POINTS = 5;
export const BRIEF_ODDS_MOVE_POINTS = 10;
export const ENDING_SOON_MS = 48 * 60 * 60 * 1000;
export const VOLUME_SPIKE_MULTIPLE = 2;
export const MAX_PER_BET_CENTS = [100, 200, 500] as const;
export const DEFAULT_DAILY_BUDGET_CENTS = 300;
export const DEFAULT_MAX_PER_BET_CENTS = 200;
export const TRIGGER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const X_SURGE_MULTIPLE = 3;
export const X_SURGE_MIN_POSTS = 20;

export type AgentModel = "grok" | "claude" | "other";
export type AgentPersonality = "calm" | "contrarian" | "momentum" | "coach";
export type AgentStatus = "watching" | "paused";
export type AgentPermission = "watch" | "suggest" | "autonomous";
export type MessageSource = "llm" | "template";
export type AgentActivityKind = "message" | "suggestion" | "bet" | "brief" | "pause" | "resume" | "refused";

export type WatchTriggerId = "oddsMove" | "volumeSpike" | "xMentions" | "breakingNews" | "oddsCross" | "endingSoon";
export type BriefTriggerId = "briefOddsMove10" | "briefMonday" | "briefEndingSoon";
export type TriggerId = WatchTriggerId | BriefTriggerId;

export interface WatchTriggers {
  readonly oddsMove: boolean;
  readonly volumeSpike: boolean;
  readonly xMentions: boolean;
  readonly breakingNews: boolean;
  readonly oddsCross: boolean;
  readonly oddsCrossLevel: number | null;
  readonly endingSoon: boolean;
}

export interface BriefTriggers {
  readonly oddsMove10: boolean;
  readonly everyMonday: boolean;
  readonly endingSoon: boolean;
}

export interface AgentActivity {
  readonly id: string;
  readonly at: string;
  readonly kind: AgentActivityKind;
  readonly text: string;
  readonly trigger?: TriggerId | undefined;
  readonly messageSource?: MessageSource | undefined;
  readonly intentId?: string | undefined;
  readonly url?: string | undefined;
}

export interface AgentRecord {
  readonly id: string;
  readonly eventTicker: string;
  readonly instrumentSymbol: string;
  readonly name: string;
  readonly model: AgentModel;
  readonly personality: AgentPersonality;
  readonly instructions: string;
  readonly status: AgentStatus;
  readonly triggers: WatchTriggers;
  readonly dailyBudgetCents: number;
  readonly maxPerBetCents: (typeof MAX_PER_BET_CENTS)[number];
  readonly permission: AgentPermission;
  readonly writeBriefs: boolean;
  readonly briefTriggers: BriefTriggers;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunAt: string | null;
  readonly lastMessage: string | null;
  readonly lastMessageSource: MessageSource | null;
  readonly lastBreakingPostId?: string | undefined;
  readonly spentTodayCents: number;
  readonly spendDay: string;
  readonly lastTriggerAt: Readonly<Record<string, string>>;
  readonly activity: readonly AgentActivity[];
}

export const PERSONALITY_COPY: Readonly<Record<AgentPersonality, { readonly label: string; readonly blurb: string; readonly voice: string }>> = {
  calm: { label: "Calm analyst", blurb: "Measured, cites numbers, flags risk first", voice: "Be measured. Cite the numbers first and flag risk before any suggestion." },
  contrarian: { label: "Contrarian", blurb: "Pushes back on crowd hype", voice: "Push back on crowd hype. Ask what the market might be missing." },
  momentum: { label: "Momentum hunter", blurb: "Looks for moves backed by volume", voice: "Look for moves backed by real volume. Do not chase a move with no participation." },
  coach: { label: "Plain-English coach", blurb: "Explains everything, no jargon", voice: "Explain everything in plain English, with no jargon." },
};

export const DEFAULT_TRIGGERS: WatchTriggers = {
  oddsMove: true,
  volumeSpike: true,
  xMentions: false,
  breakingNews: false,
  oddsCross: false,
  oddsCrossLevel: null,
  endingSoon: true,
};

export const DEFAULT_BRIEF_TRIGGERS: BriefTriggers = {
  oddsMove10: true,
  everyMonday: false,
  endingSoon: true,
};

export { rolledSpend, utcDay } from "@/shared";
