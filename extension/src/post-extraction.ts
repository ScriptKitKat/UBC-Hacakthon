export const MIN_TEXT_LENGTH = 20;

export interface ExtractedPost {
  readonly id: string;
  readonly text: string;
  readonly author: string;
  readonly url: string;
}

const STATUS_PATH = /^\/([A-Za-z0-9_]+)\/status\/(\d+)/u;
const HANDLE = /@[A-Za-z0-9_]{1,15}/u;

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

function statusLink(article: Element): { readonly handle: string; readonly id: string } | undefined {
  for (const anchor of article.querySelectorAll("a[href*='/status/']")) {
    if (!anchor.querySelector("time")) continue;
    const href = anchor.getAttribute("href") ?? "";
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const [, handle, id] = STATUS_PATH.exec(path) ?? [];
    if (handle !== undefined && id !== undefined) return { handle, id };
  }
  return undefined;
}

export function isTopLevelTweet(article: Element): boolean {
  return article.parentElement?.closest(TWEET_SELECTOR) == null;
}

export function extractPost(article: Element): ExtractedPost | undefined {
  const link = statusLink(article);
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent.replace(/\s+/gu, " ").trim();
  if (!link || !text) return undefined;
  const displayed = HANDLE.exec(article.querySelector('[data-testid="User-Name"]')?.textContent ?? "")?.[0];
  return { id: link.id, text, author: displayed ?? `@${link.handle}`, url: `https://x.com/${link.handle}/status/${link.id}` };
}
