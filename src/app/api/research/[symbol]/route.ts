import { parseInstrumentSymbol } from "@/features/markets";
import { isResearchTimeframe } from "@/shared";
import { withDashboardGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEFRAME = "1D";

export function GET(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  return withDashboardGet(request, async ({ research }) => {
    const { symbol } = await context.params;
    const timeframe = new URL(request.url).searchParams.get("timeframe") ?? DEFAULT_TIMEFRAME;
    const issues = [
      ...(parseInstrumentSymbol(symbol) ? [] : ["symbol: must look like GEMI-EVENT-CONTRACT"]),
      ...(isResearchTimeframe(timeframe) ? [] : ["timeframe: must be one of 1H, 1D, 1W, All"]),
    ];
    if (issues.length > 0 || !isResearchTimeframe(timeframe)) return Response.json({ error: "invalid-request", issues }, { status: 400 });
    const result = await research.view(symbol, timeframe);
    switch (result.kind) {
      case "ok":
        return Response.json(result.view);
      case "unknown-symbol":
        return Response.json({ error: "unknown-symbol" }, { status: 404 });
      case "unavailable":
        return Response.json({ error: "gemini-unavailable" }, { status: 503 });
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  });
}
