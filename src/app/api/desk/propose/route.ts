import { z } from "zod";
import { withDashboardBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  instrumentSymbol: z.string().trim().min(1),
  outcome: z.enum(["yes", "no"]),
  notionalCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  senderId: z.string().trim().min(1),
  source: z.enum(["voice", "x", "desk"]).default("desk"),
  seenPriceCents: z.number().positive().max(100).optional(),
});

export function POST(request: Request): Promise<Response> {
  return withDashboardBody(request, body, async ({ seenPriceCents, ...proposal }, desk) => Response.json({
    entry: await desk.proposeTrade({ ...proposal, ...(seenPriceCents === undefined ? {} : { seenPriceCents }) }),
  }));
}
