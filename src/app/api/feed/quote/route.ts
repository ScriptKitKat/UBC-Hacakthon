import { feedGet, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = feedPreflight;

export function GET(request: Request): Promise<Response> {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) return Promise.resolve(Response.json({ error: "invalid-request", issues: ["symbol: required"] }, { status: 400 }));
  return feedGet(request, async (desk) => {
    const quote = await desk.quote(symbol);
    return quote ? Response.json(quote) : Response.json({ error: "unknown-symbol" }, { status: 404 });
  });
}
