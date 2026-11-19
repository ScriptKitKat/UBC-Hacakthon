import { parseInstrumentSymbol } from "@/features/markets";
import { yesCentsFromBrief } from "@/shared";
import type { StoredPurchase } from "@/features/desk";
import { withDashboardGet } from "../../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function briefView(purchase: StoredPurchase | null) {
  if (purchase === null || purchase.brief === null) return null;
  return {
    at: new Date(purchase.atMs).toISOString(),
    signature: purchase.receipt.signature,
    explorerUrl: purchase.receipt.explorerUrl,
    costCents: purchase.receipt.costCents,
    yesCents: purchase.yesCents ?? yesCentsFromBrief(purchase.brief),
    brief: purchase.brief,
  };
}

export function GET(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  return withDashboardGet(request, async ({ desk }) => {
    const { symbol } = await context.params;
    if (!parseInstrumentSymbol(symbol)) {
      return Response.json({ error: "invalid-request", issues: ["symbol: must look like GEMI-EVENT-CONTRACT"] }, { status: 400 });
    }
    const { current, previous } = desk.peekResearchBriefs(symbol);
    return Response.json({ current: briefView(current), previous: briefView(previous) });
  });
}
