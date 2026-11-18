import { z } from "zod";
import { withBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  id: z.string().trim().min(1).max(100),
  inReplyToId: z.string().trim().min(1).max(100),
  authorHandle: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(1000),
});

export function POST(request: Request): Promise<Response> {
  return withBody(request, body, async ({ id, inReplyToId, authorHandle, text }, bot) => {
    if (bot.getStatus().mode === "live") {
      return Response.json({ error: "live-mode", issues: ["replies come from X in live mode; use /api/x/poll"] }, { status: 409 });
    }
    const result = await bot.handleReply({ id, inReplyToId, authorHandle, text });
    return Response.json({ result });
  });
}
