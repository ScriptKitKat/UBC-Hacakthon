export const MIN_TEXT_LENGTH = 20;

export interface ExtractedPost {
  readonly id: string;
  readonly text: string;
  readonly author: string;
  readonly url: string;
}

interface StatusRef {
  readonly handle: string;
  readonly id: string;
}

const STATUS_PATH = /^\/([A-Za-z0-9_]+)\/status\/(\d+)/u;
const HANDLE = /@[A-Za-z0-9_]{1,15}/u;
const QUOTE_SELECTOR = 'div[role="link"]';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

function isQuoted(element: Element, article: Element): boolean {
  const quote = element.closest(QUOTE_SELECTOR);
  return quote !== null && article.contains(quote);
}

export function ownElements(article: Element, selector: string): readonly Element[] {
  return [...article.querySelectorAll(selector)].filter((element) => !isQuoted(element, article));
}

function parseStatusPath(href: string): StatusRef | undefined {
  const path = href.startsWith("http") ? new URL(href).pathname : href;
  const [, handle, id] = STATUS_PATH.exec(path) ?? [];
  return handle !== undefined && id !== undefined ? { handle, id } : undefined;
}

function statusRef(article: Element, pathname: string): StatusRef | undefined {
  for (const anchor of ownElements(article, "a[href*='/status/']")) {
    if (!anchor.querySelector("time")) continue;
    const ref = parseStatusPath(anchor.getAttribute("href") ?? "");
    if (ref) return ref;
  }
  return parseStatusPath(pathname);
}

function textWithEmoji(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLImageElement) return node.alt;
  return [...node.childNodes].map(textWithEmoji).join("");
}

function authorOf(article: Element, fallbackHandle: string): string {
  const userName = ownElements(article, '[data-testid="User-Name"]')[0];
  const link = userName ? [...userName.querySelectorAll("a")].find((anchor) => anchor.textContent.trim().startsWith("@")) : undefined;
  const displayed = HANDLE.exec(link?.textContent ?? userName?.textContent ?? "")?.[0];
  return displayed ?? `@${fallbackHandle}`;
}

export function isTopLevelTweet(article: Element): boolean {
  return article.parentElement?.closest(TWEET_SELECTOR) == null;
}

export function extractPost(article: Element, pathname: string = location.pathname): ExtractedPost | undefined {
  const ref = statusRef(article, pathname);
  const textElement = ownElements(article, '[data-testid="tweetText"]')[0];
  const text = textElement ? textWithEmoji(textElement).replace(/\s+/gu, " ").trim() : "";
  if (!ref || text === "") return undefined;
  return { id: ref.id, text, author: authorOf(article, ref.handle), url: `https://x.com/${ref.handle}/status/${ref.id}` };
}
