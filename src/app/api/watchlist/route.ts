import { catalogCardSchema } from "@/shared";
import { z } from "zod";
import { withHomeBody, withHomeGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  symbol: z.string().trim().min(1),
  action: z.enum(["add", "remove"]),
});

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const symbols = await catalog.watchlist.list();
    const wantCards = new URL(request.url).searchParams.get("cards") === "1";
    if (!wantCards) return Response.json({ symbols });
    const cards = catalogCardSchema.array().parse(await catalog.cardsFor(symbols));
    return Response.json({ symbols, cards });
  });
}

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async ({ symbol, action }, { catalog }) => {
    const symbols = action === "add" ? await catalog.watchlist.add(symbol) : await catalog.watchlist.remove(symbol);
    return Response.json({ symbols });
  });
}
