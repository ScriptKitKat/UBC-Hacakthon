import { getDesk } from "@/features/desk";
import { parseInstrumentSymbol } from "@/features/markets";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, encodeHeader } from "@/features/x402";
import type { X402Server } from "@/features/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_REQUIRED = 402;
const FIRST_REQUEST_MESSAGE = "payment_required";

function paymentRequired(payments: X402Server, request: Request, symbol: string, error: string): Response {
  const resource = new URL(request.url);
  resource.search = "";
  return Response.json(payments.requirements(symbol, resource.href, `Deep dive research brief for ${symbol}`, error), { status: PAYMENT_REQUIRED });
}

export async function GET(request: Request, context: { readonly params: Promise<{ readonly symbol: string }> }): Promise<Response> {
  const { symbol } = await context.params;
  if (!parseInstrumentSymbol(symbol)) {
    return Response.json({ error: "invalid-request", issues: ["symbol: must look like GEMI-EVENT-CONTRACT"] }, { status: 400 });
  }
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  const { payments, research } = access;
  if (!payments) return Response.json({ error: "research-payments-not-configured" }, { status: 503 });

  const header = request.headers.get(PAYMENT_HEADER);
  if (header === null) return paymentRequired(payments, request, symbol, FIRST_REQUEST_MESSAGE);

  const verified = await payments.verify(header, symbol);
  if (!verified.ok) return paymentRequired(payments, request, symbol, verified.error);

  const brief = await research.brief(symbol);
  if (brief.kind === "unknown-symbol") return Response.json({ error: "unknown-symbol" }, { status: 404 });
  if (brief.kind === "unavailable") return Response.json({ error: "gemini-unavailable" }, { status: 503 });

  const settled = await payments.settle(verified.value);
  if (!settled.ok) return paymentRequired(payments, request, symbol, settled.error);
  const { signature, network, payer } = settled.value;
  return Response.json(await brief.polished(), {
    headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: signature, network, payer }) },
  });
}
