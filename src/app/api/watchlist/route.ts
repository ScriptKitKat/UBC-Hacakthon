import { resolveWatchlistWrite, watchlistIdentifiers } from "@/features/catalog";
import { watchlistCardSchema } from "@/shared";
import { z } from "zod";
import { withHomeBody, withHomeGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  action: z.enum(["add", "remove"]),
  symbol: z.string().trim().min(1).optional(),
  eventTicker: z.string().trim().min(1).optional(),
  contract: z.string().trim().min(1).optional(),
  yesCents: z.number().nullable().optional(),
}).refine((value) => value.symbol !== undefined || value.eventTicker !== undefined || value.contract !== undefined, {
  message: "eventTicker, contract, or symbol is required",
});

function payload(items: readonly { eventTicker: string; instrumentSymbol: string | null; savedAt: string | null; savedYesCents: number | null }[], cards?: unknown) {
  const symbols = watchlistIdentifiers(items);
  if (cards === undefined) return { symbols, items };
  return { symbols, items, cards };
}

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const items = await catalog.watchlist.items();
    const wantCards = new URL(request.url).searchParams.get("cards") === "1";
    if (!wantCards) return Response.json(payload(items));
    const cards = watchlistCardSchema.array().parse(await catalog.cardsForSaved(items));
    return Response.json(payload(items, cards));
  });
}

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async (input, { catalog }) => {
    const resolved = resolveWatchlistWrite({
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
      ...(input.eventTicker === undefined ? {} : { eventTicker: input.eventTicker }),
      ...(input.contract === undefined ? {} : { contract: input.contract }),
      ...(input.yesCents === undefined ? {} : { yesCents: input.yesCents }),
    });
    if (resolved === undefined) return Response.json({ error: "invalid-request", issues: ["eventTicker, contract, or symbol is required"] }, { status: 400 });
    const write = {
      eventTicker: resolved.eventTicker,
      ...(resolved.instrumentSymbol === null ? {} : { contract: resolved.instrumentSymbol }),
    };
    if (input.action === "remove") {
      const items = await catalog.watchlist.remove(write);
      return Response.json(payload(items));
    }
    let yesCents = input.yesCents;
    if (yesCents === undefined) {
      const [card] = await catalog.cardsForSaved([resolved]);
      yesCents = card?.yesCents ?? null;
    }
    const items = await catalog.watchlist.add({ ...write, yesCents: yesCents ?? null });
    return Response.json(payload(items));
  });
}
