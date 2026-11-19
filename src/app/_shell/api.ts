import { browsePageSchema, catalogCardSchema, homeRailSchema, homeViewSchema } from "@/shared";
import type { BrowsePage, BrowseSort, CatalogCard, CatalogPage, FeedMatch, HomeRail, HomeView } from "@/shared";

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

export async function loadWatchlist(): Promise<readonly string[]> {
  const response = await fetch("/api/watchlist", { headers: { accept: "application/json" } });
  if (!response.ok) return [];
  const body = await response.json() as { symbols?: unknown };
  return Array.isArray(body.symbols) ? body.symbols.filter((item): item is string => typeof item === "string") : [];
}

export async function loadWatchlistCards(): Promise<{ readonly symbols: readonly string[]; readonly cards: readonly CatalogCard[] } | undefined> {
  const response = await fetch("/api/watchlist?cards=1", { headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const body = await response.json() as { symbols?: unknown; cards?: unknown };
  const symbols = Array.isArray(body.symbols) ? body.symbols.filter((item): item is string => typeof item === "string") : [];
  const parsed = catalogCardSchema.array().safeParse(body.cards);
  return { symbols, cards: parsed.success ? parsed.data : [] };
}

export async function changeWatchlist(symbol: string, action: "add" | "remove"): Promise<readonly string[]> {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ symbol, action }),
  });
  if (!response.ok) return [];
  const body = await response.json() as { symbols?: unknown };
  return Array.isArray(body.symbols) ? body.symbols.filter((item): item is string => typeof item === "string") : [];
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
}
