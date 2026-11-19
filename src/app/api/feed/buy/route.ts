import { z } from "zod";
import { MAX_FEED_BUY_CENTS } from "@/shared";
import { feedTradingPost, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  postId: z.string().trim().min(1).max(64),
  instrumentSymbol: z.string().trim().min(1).max(128),
  outcome: z.enum(["yes", "no"]),
  amountCents: z.number().int().positive().max(MAX_FEED_BUY_CENTS),
  clientOrderId: z.uuid(),
  seenPriceCents: z.number().int().min(1).max(100).optional(),
});

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return feedTradingPost(request, body, async ({ postId, instrumentSymbol, outcome, amountCents, clientOrderId, seenPriceCents }, desk) => {
    const existing = desk.feedOrder(clientOrderId);
    if (existing) return Response.json({ entry: await existing });
    if (!(await desk.isCardFor(postId, instrumentSymbol))) return Response.json({ error: "no-matching-card" }, { status: 409 });
    const entry = await desk.buyFromFeed({
      clientOrderId,
      instrumentSymbol,
      outcome,
      notionalCents: amountCents,
      ...(seenPriceCents === undefined ? {} : { seenPriceCents }),
    });
    return Response.json({ entry });
  });
}
