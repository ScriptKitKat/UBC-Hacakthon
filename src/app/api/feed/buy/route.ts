import { z } from "zod";
import { feedPost, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BUY_CENTS = 100_000;

const body = z.object({
  postId: z.string().trim().min(1).max(64),
  instrumentSymbol: z.string().trim().min(1).max(128),
  outcome: z.enum(["yes", "no"]),
  amountCents: z.number().int().positive().max(MAX_BUY_CENTS),
});

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return feedPost(request, body, async ({ instrumentSymbol, outcome, amountCents }, desk) =>
    Response.json({ entry: await desk.buyFromFeed({ instrumentSymbol, outcome, notionalCents: amountCents }) }),
  );
}
