import type { Desk } from "@/features/desk";
import type {
  DecisionLogEntry,
  MarketView,
  MatchView,
  PolicyView,
  XBotStatusView,
  XMessageRole,
  XMessageView,
  XThreadView,
} from "@/shared";
import {
  composeDecisionReply,
  composeNewsReply,
  composeStatusReply,
  FAILURE_REPLY,
  NO_MARKET_REPLY,
  NO_MATCH_NOTE,
  NOT_ALLOWLISTED_REPLY,
  NOTHING_PENDING_REPLY,
} from "./compose-reply";
import { isHandle, normalizeHandle } from "./handles";
import { parseCommand } from "./parse-command";
import type { XCommand } from "./parse-command";
import type { NewsPost, XClient, XError, XReply } from "./types";

const THREAD_LIMIT = 50;

export interface XBotDeps {
  readonly desk: Desk;
  readonly client: XClient;
  readonly now: () => Date;
  readonly idGen: () => string;
  readonly botHandle: string;
  readonly configuredMissing?: readonly string[];
}

export type IngestResult =
  | { readonly kind: "duplicate" }
  | { readonly kind: "ingested"; readonly match: MatchView; readonly posted: boolean };

export type ReplyResult = "handled" | "duplicate" | "unrouted" | "ignored";

export interface PollSummary {
  readonly fetched: number;
  readonly handled: number;
  readonly duplicates: number;
  readonly unrouted: number;
  readonly ignored: number;
  readonly error?: XError["kind"];
}

export interface XBot {
  readonly ingestNewsPost: (post: NewsPost) => Promise<IngestResult>;
  readonly handleReply: (reply: XReply) => Promise<ReplyResult>;
  readonly pollMentions: () => Promise<PollSummary>;
  readonly getThreads: () => readonly XThreadView[];
  readonly getStatus: () => XBotStatusView;
}

type BotReplyMeta = Pick<XMessageView, "decisionKind" | "ticketId" | "signature" | "explorerUrl">;

function allowlistedSpelling(normalized: string, policy: PolicyView): string | undefined {
  return policy.senderAllowlist.find((entry) => isHandle(entry) && normalizeHandle(entry) === normalized);
}

function decisionMeta(entry: DecisionLogEntry): BotReplyMeta {
  return {
    decisionKind: entry.kind,
    ...(entry.ticket ? { ticketId: entry.ticket.ticketId } : {}),
    ...(entry.signature ? { signature: entry.signature } : {}),
    ...(entry.explorerUrl ? { explorerUrl: entry.explorerUrl } : {}),
  };
}

export function createXBot(deps: XBotDeps): XBot {
  const { desk, client, now, idGen } = deps;
  const botHandle = normalizeHandle(deps.botHandle);
  const onX = client.mode === "live";
  const threads = new Map<string, XThreadView>();
  const threadOfMessage = new Map<string, string>();
  const intentsOfThread = new Map<string, string[]>();
  const seenNews = new Set<string>();
  const seenReplies = new Set<string>();
  let cursor: string | undefined;

  function isKnownId(id: string): boolean {
    return seenNews.has(id) || seenReplies.has(id) || threadOfMessage.has(id);
  }

  function threadFor(threadId: string): XThreadView {
    const thread = threads.get(threadId);
    if (!thread) throw new Error(`Unknown thread ${threadId}`);
    return thread;
  }

  function appendMessage(threadId: string, message: XMessageView): void {
    const thread = threadFor(threadId);
    threads.set(threadId, { ...thread, messages: [...thread.messages, message] });
    threadOfMessage.set(message.id, threadId);
  }

  function recordMessage(threadId: string, role: XMessageRole, id: string, author: string, text: string): void {
    appendMessage(threadId, { id, role, text, author, at: now().toISOString(), postedToX: onX });
  }

  function recordOutcome(threadId: string, entry: DecisionLogEntry): void {
    const thread = threadFor(threadId);
    threads.set(threadId, { ...thread, outcomes: [...thread.outcomes, { intentId: entry.intentId, kind: entry.kind, at: entry.at }] });
    intentsOfThread.set(threadId, [...(intentsOfThread.get(threadId) ?? []), entry.intentId]);
  }

  function evictOldThreads(): void {
    for (const [threadId] of threads) {
      if (threads.size <= THREAD_LIMIT) return;
      threads.delete(threadId);
      intentsOfThread.delete(threadId);
      for (const [messageId, owner] of threadOfMessage) {
        if (owner === threadId) threadOfMessage.delete(messageId);
      }
    }
  }

  async function reply(threadId: string, inReplyToId: string, text: string, meta: BotReplyMeta = {}): Promise<boolean> {
    const base = { role: "bot", author: botHandle, text, at: now().toISOString(), ...meta } as const;
    if (!threadFor(threadId).market) {
      appendMessage(threadId, { ...base, id: idGen(), postedToX: false });
      return false;
    }
    const result = await client.postReply(inReplyToId, text);
    if (result.ok) {
      const id = isKnownId(result.value.id) ? idGen() : result.value.id;
      appendMessage(threadId, { ...base, id, postedToX: onX });
      return true;
    }
    appendMessage(threadId, { ...base, id: idGen(), postedToX: false, postError: result.error.kind });
    return false;
  }

  async function handleBet(
    threadId: string,
    replyTo: string,
    market: MarketView,
    command: Extract<XCommand, { kind: "bet" }>,
    senderId: string,
  ): Promise<void> {
    const entry = await desk.proposeTrade({
      instrumentSymbol: market.instrumentSymbol,
      outcome: command.outcome,
      notionalCents: command.notionalCents,
      source: "x",
      senderId,
    });
    recordOutcome(threadId, entry);
    await reply(threadId, replyTo, composeDecisionReply(entry), decisionMeta(entry));
  }

  async function handleApprove(threadId: string, replyTo: string, senderId: string): Promise<void> {
    const { pending } = await desk.getSnapshot();
    const waiting = new Set(pending.filter((intent) => intent.senderId === senderId).map((intent) => intent.intentId));
    const intentId = (intentsOfThread.get(threadId) ?? []).findLast((candidate) => waiting.has(candidate));
    const result = intentId === undefined ? undefined : await desk.confirmPending(intentId, senderId);
    if (!result?.ok) {
      await reply(threadId, replyTo, NOTHING_PENDING_REPLY);
      return;
    }
    recordOutcome(threadId, result.entry);
    await reply(threadId, replyTo, composeDecisionReply(result.entry), decisionMeta(result.entry));
  }

  async function execute(threadId: string, incoming: XReply, command: XCommand): Promise<void> {
    if (command.kind === "unknown") return;
    const snapshot = await desk.getSnapshot();
    if (!isHandle(incoming.authorHandle)) {
      await reply(threadId, incoming.id, NOT_ALLOWLISTED_REPLY);
      return;
    }
    const normalized = normalizeHandle(incoming.authorHandle);
    const allowlisted = allowlistedSpelling(normalized, snapshot.policy);
    if (command.kind === "bet") {
      const { market } = threadFor(threadId);
      if (market) await handleBet(threadId, incoming.id, market, command, allowlisted ?? normalized);
      else await reply(threadId, incoming.id, NO_MARKET_REPLY);
      return;
    }
    if (allowlisted === undefined) {
      await reply(threadId, incoming.id, NOT_ALLOWLISTED_REPLY);
      return;
    }
    switch (command.kind) {
      case "approve":
        await handleApprove(threadId, incoming.id, allowlisted);
        return;
      case "status":
        await reply(threadId, incoming.id, composeStatusReply(snapshot.policy, snapshot.pending.length));
        return;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }

  async function handleReply(incoming: XReply): Promise<ReplyResult> {
    if (isKnownId(incoming.id)) return "duplicate";
    seenReplies.add(incoming.id);
    const author = isHandle(incoming.authorHandle) ? normalizeHandle(incoming.authorHandle) : incoming.authorHandle;
    if (author === botHandle) return "ignored";
    const threadId = threadOfMessage.get(incoming.inReplyToId);
    if (threadId === undefined) return "unrouted";
    recordMessage(threadId, "user", incoming.id, author, incoming.text);
    try {
      await execute(threadId, incoming, parseCommand(incoming.text));
    } catch {
      await reply(threadId, incoming.id, FAILURE_REPLY);
    }
    return "handled";
  }

  async function ingestNewsPost(post: NewsPost): Promise<IngestResult> {
    if (isKnownId(post.id)) return { kind: "duplicate" };
    seenNews.add(post.id);
    const author = normalizeHandle(post.authorHandle);
    const match = await desk
      .submitNews({
        id: post.id,
        text: post.text,
        author,
        postedAt: post.postedAt,
        ...(post.url ? { url: post.url } : {}),
      })
      .catch((error: unknown) => {
        seenNews.delete(post.id);
        throw error;
      });
    threads.set(post.id, { id: post.id, market: match.kind === "matched" ? match.market : null, messages: [], outcomes: [] });
    evictOldThreads();
    recordMessage(post.id, "news", post.id, author, post.text);
    if (match.kind !== "matched") {
      await reply(post.id, post.id, NO_MATCH_NOTE);
      return { kind: "ingested", match, posted: false };
    }
    const { policy } = await desk.getSnapshot();
    const posted = await reply(post.id, post.id, composeNewsReply(match, policy));
    return { kind: "ingested", match, posted };
  }

  async function pollMentions(): Promise<PollSummary> {
    const page = await client.fetchMentions(cursor);
    if (!page.ok) return { fetched: 0, handled: 0, duplicates: 0, unrouted: 0, ignored: 0, error: page.error.kind };
    const tally = { handled: 0, duplicates: 0, unrouted: 0, ignored: 0 };
    for (const post of page.value.posts) {
      if (post.inReplyToId === undefined) {
        tally.unrouted += 1;
        continue;
      }
      const result = await handleReply({ id: post.id, inReplyToId: post.inReplyToId, authorHandle: post.authorHandle, text: post.text });
      if (result === "handled") tally.handled += 1;
      else if (result === "duplicate") tally.duplicates += 1;
      else if (result === "unrouted") tally.unrouted += 1;
      else tally.ignored += 1;
    }
    cursor = page.value.newestId ?? cursor;
    return { fetched: page.value.posts.length, ...tally };
  }

  return {
    ingestNewsPost,
    handleReply,
    pollMentions,
    getThreads: () => [...threads.values()].reverse(),
    getStatus: () => ({ mode: client.mode, configuredMissing: deps.configuredMissing ?? [] }),
  };
}
