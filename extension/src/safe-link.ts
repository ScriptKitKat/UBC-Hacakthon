const GEMINI_HOSTS = new Set(["gemini.com", "www.gemini.com"]);
const EXPLORER_HOSTS = new Set(["explorer.solana.com"]);

function isHttpsHost(url: string, hosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.port === "" && hosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function isSafeGeminiLink(url: string): boolean {
  return isHttpsHost(url, GEMINI_HOSTS);
}

export function isSafeExplorerLink(url: string): boolean {
  return isHttpsHost(url, EXPLORER_HOSTS);
}
