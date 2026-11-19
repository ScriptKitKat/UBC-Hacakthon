import { parseInstrumentSymbol } from "@/features/markets";
import { isProTimeframe, proLiveSchema, proShellSchema } from "@/shared";
import { withHomeGet } from "../../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  return withHomeGet(request, async ({ marketPro }) => {
    const { symbol } = await context.params;
    const query = new URL(request.url).searchParams;
    const rawTimeframe = query.get("timeframe");
    const part = query.get("part") ?? "shell";
    const issues = [
      ...(parseInstrumentSymbol(symbol) ? [] : ["symbol: must look like GEMI-EVENT-CONTRACT"]),
      ...(rawTimeframe === null || isProTimeframe(rawTimeframe) ? [] : ["timeframe: must be one of 5m, 1h, 4h, 1D, 1W"]),
      ...(part === "shell" || part === "live" ? [] : ["part: must be shell or live"]),
    ];
    const timeframe = rawTimeframe !== null && isProTimeframe(rawTimeframe) ? rawTimeframe : undefined;
    if (issues.length > 0 || (part !== "shell" && part !== "live")) {
      return Response.json({ error: "invalid-request", issues }, { status: 400 });
    }
    if (part === "shell") {
      const result = await marketPro.shell(symbol, timeframe);
      if (result.kind === "ok") return Response.json(proShellSchema.parse(result.shell));
      return fail(result.kind);
    }
    const result = await marketPro.live(symbol, timeframe ?? "1D");
    if (result.kind === "ok") return Response.json(proLiveSchema.parse(result.live));
    return fail(result.kind);
  });
}

function fail(kind: "unknown-symbol" | "unavailable"): Response {
  if (kind === "unknown-symbol") return Response.json({ error: "unknown-symbol" }, { status: 404 });
  return Response.json({ error: "gemini-unavailable" }, { status: 503 });
}
