import { ok } from "@/features/markets";
import type { XClient, XPost } from "./types";

export interface PostedReply {
  readonly id: string;
  readonly inReplyToId: string;
  readonly text: string;
}

export interface FakeXClient extends XClient {
  readonly mode: "fake";
  readonly posted: () => readonly PostedReply[];
  readonly injectMention: (post: XPost) => void;
}

export function createFakeXClient(): FakeXClient {
  const posted: PostedReply[] = [];
  const mentions: XPost[] = [];
  let counter = 0;
  return {
    mode: "fake",
    postReply: (inReplyToId, text) => {
      counter += 1;
      const reply = { id: `fake-${String(counter)}`, inReplyToId, text };
      posted.push(reply);
      return Promise.resolve(ok({ id: reply.id }));
    },
    fetchMentions: (sinceId) => {
      const start = sinceId === undefined ? 0 : mentions.findIndex((mention) => mention.id === sinceId) + 1;
      const newest = mentions.at(-1);
      return Promise.resolve(ok({ posts: mentions.slice(start), ...(newest ? { newestId: newest.id } : {}) }));
    },
    posted: () => [...posted],
    injectMention: (post) => {
      mentions.push(post);
    },
  };
}
