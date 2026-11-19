import { feedPositionsSchema } from "@/shared";
import { feedPrivateGet, feedReadPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = feedReadPreflight;

export function GET(request: Request): Promise<Response> {
  return feedPrivateGet(request, async (desk) =>
    Response.json(feedPositionsSchema.parse(await desk.getFeedPositions()), { headers: { "cache-control": "no-store" } }),
  );
}
