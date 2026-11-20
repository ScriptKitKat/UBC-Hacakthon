export interface XBreakingPost {
  readonly id: string;
  readonly text: string;
  readonly authorUsername: string;
  readonly url: string;
}

export interface XCounts {
  readonly lastHourCount: number;
  readonly baselineHourlyCount: number;
}

export interface XSignals {
  readonly counts: XCounts | undefined;
  readonly breakingPost: XBreakingPost | null | undefined;
}

export interface XFeed {
  readonly signals: (query: string) => Promise<XSignals | undefined>;
}
