import { parseInstrumentSymbol } from "@/features/markets";
import { withDashboardPost } from "../../../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  return withDashboardPost(request, async (desk) => {
    const { symbol } = await context.params;
    if (!parseInstrumentSymbol(symbol)) {
      return Response.json({ error: "invalid-request", issues: ["symbol: must look like GEMI-EVENT-CONTRACT"] }, { status: 400 });
    }
    return Response.json(await desk.buyDeepDive(symbol));
  });
}
