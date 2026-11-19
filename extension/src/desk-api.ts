import { feedPositionsSchema } from "@/shared";
import type { BackgroundReply, BackgroundRequest, ReplyValues } from "./protocol";
import { entryResponseSchema, feedMatchSchema, feedQuoteSchema } from "./wire";
import type { WireEntry } from "./wire";
import { parseDeskUrl } from "./settings";
import { tradeBudgetFrom } from "./trade-budget";

interface CallInit {
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly cache?: RequestCache;
}

interface Call {
  readonly path: string;
  readonly init: CallInit;
  readonly parse: (body: unknown) => unknown;
}

export interface DeskTarget {
  readonly url: string;
  readonly token: string;
}

function post(path: string, body: unknown, parse: Call["parse"]): Call {
  return { path, parse, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } };
}

function authorized(call: Call, token: string): Call {
  return token === "" ? call : { ...call, init: { ...call.init, headers: { ...call.init.headers, authorization: `Bearer ${token}` } } };
}

function entryOf(body: unknown): WireEntry | undefined {
  const parsed = entryResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.entry : undefined;
}

function callFor(request: BackgroundRequest): Call {
  switch (request.type) {
    case "match":
      return post("/api/feed/match", { postId: request.postId, text: request.text, author: request.author, url: request.url }, (body) => {
        const parsed = feedMatchSchema.safeParse(body);
        return parsed.success ? parsed.data : undefined;
      });
    case "budget":
    case "positions":
      return {
        path: "/api/feed/positions",
        init: { method: "GET", cache: "no-store" },
        parse: (body) => {
          const parsed = feedPositionsSchema.safeParse(body);
          if (!parsed.success) return undefined;
          return request.type === "budget" ? tradeBudgetFrom(parsed.data.budget) : parsed.data;
        },
      };
    case "quote":
      return {
        path: `/api/feed/quote?symbol=${encodeURIComponent(request.symbol)}`,
        init: { method: "GET" },
        parse: (body) => {
          const parsed = feedQuoteSchema.safeParse(body);
          return parsed.success ? parsed.data : undefined;
        },
      };
    case "buy":
      return post(
        "/api/feed/buy",
        {
          postId: request.postId,
          instrumentSymbol: request.instrumentSymbol,
          outcome: request.outcome,
          amountCents: request.amountCents,
          clientOrderId: request.clientOrderId,
          seenPriceCents: request.seenPriceCents,
        },
        entryOf,
      );
    case "confirm":
      return post("/api/feed/confirm", { intentId: request.intentId }, entryOf);
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}

function statusError(status: number): string {
  if (status === 503) return "The desk is not configured.";
  if (status === 401) return "The desk rejected the desk token. Check the extension options.";
  if (status === 409) return "This card is out of date. Refresh the page.";
  if (status === 403) return "The desk refused this extension.";
  if (status === 404) return "The desk no longer knows this market.";
  return `The desk returned an error (${String(status)}).`;
}

export async function callDesk<K extends BackgroundRequest["type"]>(
  desk: DeskTarget,
  request: Extract<BackgroundRequest, { type: K }>,
  fetchImpl: typeof fetch,
): Promise<BackgroundReply<ReplyValues[K]>> {
  if ((request.type === "positions" || request.type === "budget") && desk.token === "") return { ok: false, error: "Set a desk token in the extension options." };
  const url = parseDeskUrl(desk.url);
  if (url === undefined) return { ok: false, error: "Set a valid desk URL in the extension options." };
  const base = callFor(request);
  const call = request.type === "buy" || request.type === "confirm" || request.type === "positions" || request.type === "budget" ? authorized(base, desk.token) : base;
  let response: Response;
  try {
    response = await fetchImpl(`${url}${call.path}`, { ...call.init, redirect: "error" });
  } catch {
    return { ok: false, error: "Can't reach the desk. Is it running?" };
  }
  if (!response.ok) return { ok: false, error: statusError(response.status) };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "The desk sent an unreadable response." };
  }
  const value = call.parse(body);
  return value === undefined ? { ok: false, error: "The desk sent an unexpected response." } : { ok: true, value: value as ReplyValues[K] };
}
