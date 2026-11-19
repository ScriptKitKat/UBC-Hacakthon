export const DEFAULT_DESK_URL = "http://localhost:3000";
export const DESK_URL_KEY = "deskUrl";
export const DESK_TOKEN_KEY = "deskToken";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(url: string): boolean {
  return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
}

export function parseDeskUrl(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol === "https:") return url.origin;
  return url.protocol === "http:" && isLocalHost(url.origin) ? url.origin : undefined;
}

const SYMBOL_PATTERN = /^GEMI-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u;

export function researchUrl(deskUrl: string, symbol: string): string | undefined {
  const origin = parseDeskUrl(deskUrl);
  return origin !== undefined && SYMBOL_PATTERN.test(symbol) ? `${origin}/markets/${symbol}` : undefined;
}

export function resolveDeskToken(stored: unknown, bakedIn: string): string {
  return typeof stored === "string" && stored.trim() !== "" ? stored.trim() : bakedIn;
}

export async function loadDeskUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get({ [DESK_URL_KEY]: DEFAULT_DESK_URL });
  const value = stored[DESK_URL_KEY];
  return (typeof value === "string" ? parseDeskUrl(value) : undefined) ?? DEFAULT_DESK_URL;
}

export async function loadDeskToken(): Promise<string> {
  const stored = await chrome.storage.local.get({ [DESK_TOKEN_KEY]: "" });
  return resolveDeskToken(stored[DESK_TOKEN_KEY], __DEFAULT_DESK_TOKEN__);
}

export async function saveDeskUrl(url: string): Promise<void> {
  await chrome.storage.sync.set({ [DESK_URL_KEY]: url });
}

export async function saveDeskToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [DESK_TOKEN_KEY]: token.trim() });
}
