import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { fail, ok } from "@/features/markets";
import type { XCredentials } from "./config";
import { isHandle, normalizeHandle } from "./handles";
import { mentionsResponse, postResponse } from "./live-schema";
import type { MentionsResponse } from "./live-schema";
import { authorizationHeader } from "./oauth";
import type { MentionsPage, XClient, XError, XPost, XResult } from "./types";

const API_BASE = "https://api.x.com/2";
const MENTIONS_PAGE_SIZE = "100";

export interface LiveXClientOptions {
  readonly credentials: XCredentials;
  readonly fetch: typeof fetch;
  readonly userId: string;
  readonly now?: () => Date;
  readonly nonce?: () => string;
}

function httpError(status: number): XError {
  switch (status) {
    case 401:
      return { kind: "unauthorized" };
    case 403:
      return { kind: "forbidden" };
    case 429:
      return { kind: "rate-limited" };
    default:
      return { kind: "http", status };
  }
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  if (difference === 0n) return 0;
  return difference < 0n ? -1 : 1;
}

function toMentionsPage(response: MentionsResponse): MentionsPage {
  const handles = new Map(
    (response.includes?.users ?? []).filter((user) => isHandle(user.username)).map((user) => [user.id, normalizeHandle(user.username)]),
  );
  const posts = (response.data ?? []).flatMap((post): XPost[] => {
    const authorHandle = post.author_id === undefined ? undefined : handles.get(post.author_id);
    if (authorHandle === undefined) return [];
    const parent = post.referenced_tweets?.find((reference) => reference.type === "replied_to");
    return [
      {
        id: post.id,
        text: post.text,
        authorHandle,
        ...(parent ? { inReplyToId: parent.id } : {}),
        ...(post.created_at ? { createdAt: post.created_at } : {}),
      },
    ];
  });
  const newestId = response.meta?.newest_id;
  return { posts: posts.sort((left, right) => compareIds(left.id, right.id)), ...(newestId ? { newestId } : {}) };
}

export function createLiveXClient(options: LiveXClientOptions): XClient {
  const { credentials, userId } = options;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => randomBytes(16).toString("hex"));

  async function call<S extends z.ZodType>(url: string, init: RequestInit, schema: S): Promise<XResult<z.output<S>>> {
    let response: Response;
    try {
      response = await options.fetch(url, init);
    } catch {
      return fail({ kind: "network" });
    }
    if (!response.ok) return fail(httpError(response.status));
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail({ kind: "parse" });
    }
    const parsed = schema.safeParse(body);
    return parsed.success ? ok(parsed.data) : fail({ kind: "parse" });
  }

  return {
    mode: "live",

    async postReply(inReplyToId, text) {
      const url = `${API_BASE}/tweets`;
      const authorization = authorizationHeader({
        method: "POST",
        url,
        credentials,
        nonce: nonce(),
        timestamp: String(Math.floor(now().getTime() / 1000)),
      });
      const result = await call(
        url,
        {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyToId } }),
        },
        postResponse,
      );
      return result.ok ? ok({ id: result.value.data.id }) : result;
    },

    async fetchMentions(sinceId) {
      const query = new URLSearchParams({
        ...(sinceId === undefined ? {} : { since_id: sinceId }),
        max_results: MENTIONS_PAGE_SIZE,
        expansions: "author_id,referenced_tweets.id",
        "tweet.fields": "author_id,conversation_id,referenced_tweets,created_at",
        "user.fields": "username",
      });
      const result = await call(
        `${API_BASE}/users/${encodeURIComponent(userId)}/mentions?${query.toString()}`,
        { headers: { authorization: `Bearer ${credentials.bearerToken}` } },
        mentionsResponse,
      );
      return result.ok ? ok(toMentionsPage(result.value)) : result;
    },
  };
}
