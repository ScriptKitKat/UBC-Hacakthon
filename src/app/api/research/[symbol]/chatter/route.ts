import { parseInstrumentSymbol } from "@/features/markets";
import { withDashboardServices } from "../../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  return withDashboardServices(request, async ({ chatter }) => {
    const { symbol } = await context.params;
    if (!parseInstrumentSymbol(symbol)) {
      return Response.json({ error: "invalid-request", issues: ["symbol: must look like GEMI-EVENT-CONTRACT"] }, { status: 400 });
    }
    const posts = chatter === undefined ? [] : await chatter.load(symbol);
    return Response.json({ posts });
  });
}
