export async function loadChatter(symbol: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/research/${encodeURIComponent(symbol)}/chatter`, { method: "POST", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
