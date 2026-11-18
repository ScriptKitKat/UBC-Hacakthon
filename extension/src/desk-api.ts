import type { BackgroundReply, BackgroundRequest, ReplyValues } from "./protocol";
import { entryResponseSchema, feedMatchSchema, feedQuoteSchema } from "./wire";
import type { WireEntry } from "./wire";

interface Call {
  readonly path: string;
  readonly init: RequestInit;
  readonly parse: (body: unknown) => unknown;
}

function post(path: string, body: unknown, parse: Call["parse"]): Call {
  return { path, parse, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } };
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
        { postId: request.postId, instrumentSymbol: request.instrumentSymbol, outcome: request.outcome, amountCents: request.amountCents },
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
  if (status === 403) return "The desk refused this extension.";
  if (status === 404) return "The desk no longer knows this market.";
  return `The desk returned an error (${String(status)}).`;
}

export async function callDesk<K extends BackgroundRequest["type"]>(
  deskUrl: string,
  request: Extract<BackgroundRequest, { type: K }>,
  fetchImpl: typeof fetch,
): Promise<BackgroundReply<ReplyValues[K]>> {
  const call = callFor(request);
  let response: Response;
  try {
    response = await fetchImpl(`${deskUrl.replace(/\/+$/u, "")}${call.path}`, call.init);
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
