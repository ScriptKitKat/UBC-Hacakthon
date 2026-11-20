export interface XBreakingPost {
  readonly id: string;
  readonly text: string;
  readonly authorUsername: string;
  readonly url: string;
}

export interface XSignals {
  readonly lastHourCount: number;
  readonly baselineHourlyCount: number;
  readonly breakingPost: XBreakingPost | null;
}

export interface XFeed {
  readonly signals: (query: string) => Promise<XSignals | undefined>;
}
