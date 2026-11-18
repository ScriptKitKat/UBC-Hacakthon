import type { Result } from "@/features/markets";

export interface XPost {
  readonly id: string;
  readonly text: string;
  readonly authorHandle: string;
  readonly inReplyToId?: string;
  readonly createdAt?: string;
}

export type XError =
  | { readonly kind: "network" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate-limited" }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "parse" };

export type XResult<T> = Result<T, XError>;

export interface MentionsPage {
  readonly posts: readonly XPost[];
  readonly newestId?: string;
}

export interface XClient {
  readonly mode: "fake" | "live";
  readonly postReply: (inReplyToId: string, text: string) => Promise<XResult<{ readonly id: string }>>;
  readonly fetchMentions: (sinceId?: string) => Promise<XResult<MentionsPage>>;
}

export interface NewsPost {
  readonly id: string;
  readonly text: string;
  readonly authorHandle: string;
  readonly url?: string;
  readonly postedAt: Date;
}

export interface XReply {
  readonly id: string;
  readonly inReplyToId: string;
  readonly authorHandle: string;
  readonly text: string;
}
