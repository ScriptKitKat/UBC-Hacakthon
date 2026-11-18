export const DEFAULT_DESK_URL = "http://localhost:3000";
export const DESK_URL_KEY = "deskUrl";

export function parseDeskUrl(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url.origin;
}

export function isLocalHost(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function loadDeskUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get({ [DESK_URL_KEY]: DEFAULT_DESK_URL });
  const value = stored[DESK_URL_KEY];
  return (typeof value === "string" ? parseDeskUrl(value) : undefined) ?? DEFAULT_DESK_URL;
}

export async function saveDeskUrl(url: string): Promise<void> {
  await chrome.storage.sync.set({ [DESK_URL_KEY]: url });
}
