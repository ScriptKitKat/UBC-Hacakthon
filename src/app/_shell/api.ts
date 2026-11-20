import { agentActivityViewSchema, agentCycleReportSchema, agentsViewSchema, browsePageSchema, homeRailSchema, homeViewSchema, watchlistViewSchema } from "@/shared";
import type { AgentActivityView, AgentsView, BrowsePage, BrowseSort, CatalogPage, FeedMatch, HomeRail, HomeView, WatchlistView } from "@/shared";

export async function loadRail(): Promise<HomeRail | undefined> {
  const response = await fetch("/api/home/rail", { headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const parsed = homeRailSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function loadHome(params: { search?: string; category?: string; sort?: "moving" | "default"; limit?: number }): Promise<
  { readonly kind: "ok"; readonly view: HomeView } | { readonly kind: "error"; readonly message: string }
> {
  const url = new URL("/api/home", window.location.origin);
  if (params.search) url.searchParams.set("search", params.search);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unavailable" })) as { error?: string };
    return { kind: "error", message: body.error === "busy" ? "Gemini is busy. Try again in a moment." : "Live markets are unavailable right now." };
  }
  const parsed = homeViewSchema.safeParse(await response.json());
  return parsed.success ? { kind: "ok", view: parsed.data } : { kind: "error", message: "The desk returned a response this page could not read." };
}

export async function matchQuery(text: string): Promise<FeedMatch | { readonly error: string }> {
  const response = await fetch("/api/home/match", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) return { error: "Could not match that post." };
  return await response.json() as FeedMatch;
}

export type WatchlistChange = {
  readonly action: "add" | "remove";
  readonly symbol?: string;
  readonly eventTicker?: string;
  readonly contract?: string;
  readonly yesCents?: number | null;
};

export async function loadWatchlist(): Promise<readonly string[]> {
  const response = await fetch("/api/watchlist", { headers: { accept: "application/json" } });
  if (!response.ok) return [];
  const parsed = watchlistViewSchema.pick({ symbols: true }).safeParse(await response.json());
  return parsed.success ? parsed.data.symbols : [];
}

export async function loadWatchlistCards(): Promise<WatchlistView | undefined> {
  const response = await fetch("/api/watchlist?cards=1", { headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const parsed = watchlistViewSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function changeWatchlist(input: WatchlistChange): Promise<{ readonly ok: true; readonly view: WatchlistView } | { readonly ok: false }> {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return { ok: false };
  const parsed = watchlistViewSchema.safeParse(await response.json());
  return parsed.success ? { ok: true, view: parsed.data } : { ok: false };
}

export async function proposeTrade(input: { symbol: string; outcome: "yes" | "no"; senderId: string; notionalCents: number }): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch("/api/desk/propose", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      instrumentSymbol: input.symbol,
      outcome: input.outcome,
      notionalCents: input.notionalCents,
      senderId: input.senderId,
      source: "desk",
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "trade-failed" })) as { error?: string };
    return { ok: false, message: body.error ?? "The trade could not be sent." };
  }
  return { ok: true };
}

export type { CatalogPage, HomeRail, HomeView };

export async function loadBrowse(params: { search?: string; category?: string; sort?: BrowseSort; offset?: number; limit?: number }): Promise<
  { readonly kind: "ok"; readonly page: BrowsePage } | { readonly kind: "error"; readonly message: string }
> {
  try {
    const url = new URL("/api/markets", window.location.origin);
    if (params.search) url.searchParams.set("search", params.search);
    if (params.category) url.searchParams.set("category", params.category);
    if (params.sort) url.searchParams.set("sort", params.sort);
    if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));
    if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "unavailable" })) as { error?: string };
      return { kind: "error", message: body.error === "busy" ? "Gemini is busy. Try again in a moment." : "Live markets are unavailable right now." };
    }
    const parsed = browsePageSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ok", page: parsed.data } : { kind: "error", message: "The desk returned a response this page could not read." };
  } catch {
    return { kind: "error", message: "Live markets are unavailable right now." };
  }
}

export async function loadSpots(assets: readonly string[]): Promise<Readonly<Record<string, string>>> {
  if (assets.length === 0) return {};
  try {
    const url = new URL("/api/markets/spots", window.location.origin);
    url.searchParams.set("assets", assets.join(","));
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return {};
    const body = await response.json() as { spots?: Record<string, string> };
    return body.spots ?? {};
  } catch {
    return {};
  }
}

export async function loadSparklines(symbols: readonly string[]): Promise<Readonly<Record<string, { readonly sparkline: readonly number[]; readonly changePercent: number | null }>>> {
  if (symbols.length === 0) return {};
  try {
    const url = new URL("/api/home/sparklines", window.location.origin);
    url.searchParams.set("symbols", symbols.join(","));
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return {};
    const body = await response.json() as { sparklines?: Record<string, { sparkline: number[]; changePercent: number | null }> };
    return body.sparklines ?? {};
  } catch {
    return {};
  }
}


export async function loadAgents(): Promise<AgentsView | undefined> {
  const response = await fetch("/api/agents", { headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const parsed = agentsViewSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function saveAgent(input: Record<string, unknown>, id?: string): Promise<AgentsView | undefined> {
  const response = await fetch(id === undefined ? "/api/agents" : `/api/agents/${encodeURIComponent(id)}`, {
    method: id === undefined ? "POST" : "PATCH",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return undefined;
  const parsed = agentsViewSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function deleteAgent(id: string): Promise<AgentsView | undefined> {
  const response = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  if (!response.ok) return undefined;
  const parsed = agentsViewSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function loadAgentActivity(): Promise<AgentActivityView | undefined> {
  const response = await fetch("/api/agents/activity", { headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const parsed = agentActivityViewSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

export async function runAgents(): Promise<boolean> {
  const response = await fetch("/api/agents/run", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  if (!response.ok) return false;
  return agentCycleReportSchema.safeParse(await response.json()).success;
}
