import { z } from "zod";
import { withDashboardBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  instrumentSymbol: z.string().trim().min(1),
  outcome: z.enum(["yes", "no"]),
  notionalCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  senderId: z.string().trim().min(1),
  source: z.enum(["x", "desk"]).default("desk"),
});

export function POST(request: Request): Promise<Response> {
  return withDashboardBody(request, body, async (proposal, desk) => Response.json({ entry: await desk.proposeTrade(proposal) }));
}
