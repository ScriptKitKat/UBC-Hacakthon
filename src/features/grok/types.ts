import type { MarketContract } from "@/features/markets";

export interface PostInput {
  readonly id: string;
  readonly text: string;
  readonly author?: string;
}

export interface PostCandidate {
  readonly eventTicker: string;
  readonly eventTitle: string;
  readonly eventStatus: string;
  readonly category: string;
  readonly contract: MarketContract;
}

export type PostMatchedBy = "grok" | "keywords";

export type PostMatchResult =
  | {
      readonly kind: "matched";
      readonly matchedBy: PostMatchedBy;
      readonly confidence: number;
      readonly why: string;
      readonly candidate: PostCandidate;
    }
  | { readonly kind: "no-match"; readonly matchedBy: PostMatchedBy; readonly reason: string };

export interface PostMatcher {
  readonly matchPost: (post: PostInput) => Promise<PostMatchResult>;
}
