import { getDesk, releaseRuntimeAccess } from "@/features/desk";
import { parseInstrumentSymbol } from "@/features/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  const { symbol } = await context.params;
  if (!parseInstrumentSymbol(symbol)) {
    return Response.json({ error: "invalid-request", issues: ["symbol: must look like GEMI-EVENT-CONTRACT"] }, { status: 400 });
  }
  const access = await getDesk();
  try {
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    if (!access.deepDive) return Response.json({ error: "research-payments-not-configured" }, { status: 503 });
    return await access.deepDive.handle(request, symbol);
  } finally {
    releaseRuntimeAccess(access);
  }
}
