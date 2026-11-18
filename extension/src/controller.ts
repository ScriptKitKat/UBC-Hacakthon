import { createCard } from "./card-view";
import type { CardHandle } from "./card-view";
import { MIN_TEXT_LENGTH, TWEET_SELECTOR, extractPost, isTopLevelTweet } from "./post-extraction";
import type { Sender } from "./protocol";

const DEFAULT_DWELL_MS = 350;
const DEFAULT_REFRESH_MS = 20_000;
const DEFAULT_SCAN_DEBOUNCE_MS = 200;
const RETRY_AFTER_FAILURE_MS = 30_000;
const MATCH_CONCURRENCY = 2;

export interface VisibilityWatcher {
  readonly observe: (element: Element) => void;
}

export interface ControllerDeps {
  readonly document: Document;
  readonly send: Sender;
  readonly watchVisibility: (onChange: (element: Element, visible: boolean) => void) => VisibilityWatcher;
  readonly dwellMs?: number;
  readonly refreshMs?: number;
  readonly scanDebounceMs?: number;
  readonly now?: () => number;
}

export interface FeedController {
  readonly start: () => void;
  readonly stop: () => void;
}

interface PostEntry {
  matchState: "unrequested" | "pending" | "matched" | "no-match";
  failedAt: number | undefined;
  card: CardHandle | undefined;
  refreshTimer: ReturnType<typeof setInterval> | undefined;
}

function createQueue(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

function insertCard(article: Element, card: CardHandle): void {
  const existing = article.querySelector("[data-ntd-card]");
  if (existing === card.host) return;
  existing?.remove();
  const groups = article.querySelectorAll('[role="group"]');
  const anchor = groups[groups.length - 1];
  const slot = anchor?.parentElement ?? anchor;
  if (slot?.parentElement) {
    slot.parentElement.insertBefore(card.host, slot);
  } else {
    article.append(card.host);
  }
}

export function createFeedController(deps: ControllerDeps): FeedController {
  const { document: doc, send } = deps;
  const dwellMs = deps.dwellMs ?? DEFAULT_DWELL_MS;
  const refreshMs = deps.refreshMs ?? DEFAULT_REFRESH_MS;
  const now = deps.now ?? (() => Date.now());
  const entries = new Map<string, PostEntry>();
  const observed = new WeakSet<Element>();
  const visibleArticles = new Set<Element>();
  const dwellTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  const postIdOf = new WeakMap<Element, string>();
  const articleOf = new Map<string, Element>();
  const enqueue = createQueue(MATCH_CONCURRENCY);
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let mutations: MutationObserver | undefined;

  function entryFor(postId: string): PostEntry {
    const existing = entries.get(postId);
    if (existing) return existing;
    const created: PostEntry = { matchState: "unrequested", failedAt: undefined, card: undefined, refreshTimer: undefined };
    entries.set(postId, created);
    return created;
  }

  async function refreshQuote(entry: PostEntry): Promise<void> {
    const { card } = entry;
    if (!card) return;
    const reply = await send({ type: "quote", symbol: card.symbol });
    if (reply.ok) card.update(reply.value);
  }

  function startRefresh(entry: PostEntry): void {
    if (entry.refreshTimer !== undefined || !entry.card) return;
    void refreshQuote(entry);
    entry.refreshTimer = setInterval(() => void refreshQuote(entry), refreshMs);
  }

  function stopRefresh(postId: string): void {
    const entry = entries.get(postId);
    if (entry?.refreshTimer === undefined) return;
    clearInterval(entry.refreshTimer);
    entry.refreshTimer = undefined;
  }

  function showCard(article: Element, postId: string, entry: PostEntry): void {
    if (!entry.card) return;
    insertCard(article, entry.card);
    if (visibleArticles.has(article)) startRefresh(entry);
    articleOf.set(postId, article);
  }

  async function requestMatch(article: Element, post: { readonly id: string; readonly text: string; readonly author: string; readonly url: string }, entry: PostEntry): Promise<void> {
    entry.matchState = "pending";
    const reply = await enqueue(() => send({ type: "match", postId: post.id, text: post.text.slice(0, 2000), author: post.author, url: post.url }));
    if (!reply.ok) {
      entry.matchState = "unrequested";
      entry.failedAt = now();
      return;
    }
    if (reply.value.kind === "no-match") {
      entry.matchState = "no-match";
      return;
    }
    entry.matchState = "matched";
    entry.card = createCard(reply.value, send);
    const target = articleOf.get(post.id) ?? article;
    if (target.isConnected && postIdOf.get(target) === post.id && visibleArticles.has(target)) showCard(target, post.id, entry);
  }

  function activate(article: Element): void {
    if (!article.isConnected || !visibleArticles.has(article)) return;
    const post = extractPost(article);
    if (!post || post.text.length < MIN_TEXT_LENGTH) return;
    postIdOf.set(article, post.id);
    articleOf.set(post.id, article);
    const entry = entryFor(post.id);
    if (entry.matchState === "matched") {
      showCard(article, post.id, entry);
    } else if (entry.matchState === "unrequested" && (entry.failedAt === undefined || now() - entry.failedAt >= RETRY_AFTER_FAILURE_MS)) {
      void requestMatch(article, post, entry);
    }
  }

  function onVisibility(article: Element, visible: boolean): void {
    const pending = dwellTimers.get(article);
    if (pending !== undefined) clearTimeout(pending);
    dwellTimers.delete(article);
    if (visible) {
      visibleArticles.add(article);
      dwellTimers.set(article, setTimeout(() => { activate(article); }, dwellMs));
      return;
    }
    visibleArticles.delete(article);
    const postId = postIdOf.get(article);
    if (postId !== undefined) stopRefresh(postId);
  }

  const watcher = deps.watchVisibility(onVisibility);

  function scan(): void {
    for (const article of doc.querySelectorAll(TWEET_SELECTOR)) {
      if (!isTopLevelTweet(article) || observed.has(article)) continue;
      observed.add(article);
      watcher.observe(article);
    }
    for (const article of visibleArticles) {
      if (!article.isConnected) onVisibility(article, false);
    }
  }

  function scheduleScan(): void {
    if (scanTimer !== undefined) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scan();
    }, deps.scanDebounceMs ?? DEFAULT_SCAN_DEBOUNCE_MS);
  }

  return {
    start() {
      scan();
      mutations = new MutationObserver(scheduleScan);
      mutations.observe(doc.body, { childList: true, subtree: true });
    },
    stop() {
      mutations?.disconnect();
      if (scanTimer !== undefined) clearTimeout(scanTimer);
      for (const timer of dwellTimers.values()) clearTimeout(timer);
      for (const postId of entries.keys()) stopRefresh(postId);
    },
  };
}
