import { z } from "zod";
import { feedTradingPost, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ intentId: z.string().trim().min(1).max(128) });

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return feedTradingPost(request, body, async ({ intentId }, desk) => {
    const result = await desk.confirmFromFeed(intentId);
    return result.ok ? Response.json({ entry: result.entry }) : Response.json({ error: result.error }, { status: 404 });
  });
}
