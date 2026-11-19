const X_ORIGINS: ReadonlySet<string> = new Set(["https://x.com", "https://twitter.com"]);

export interface MessageSender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly tab?: { readonly url?: string | undefined } | undefined;
}

function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

export function isExtensionPage(sender: MessageSender, extensionId: string): boolean {
  return sender.id === extensionId && originOf(sender.url) === `chrome-extension://${extensionId}`;
}

export function isTrustedSender(sender: MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  const ownOrigin = `chrome-extension://${extensionId}`;
  const tabOrigin = originOf(sender.tab?.url);
  if (tabOrigin !== undefined) return X_ORIGINS.has(tabOrigin) || tabOrigin === ownOrigin;
  return originOf(sender.url) === ownOrigin;
}
