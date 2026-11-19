import { z } from "zod";
import { withHomeGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  assets: z.string().min(1).max(200),
});

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const url = new URL(request.url);
    const parsed = query.safeParse({ assets: url.searchParams.get("assets") ?? undefined });
    if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
    const assets = parsed.data.assets.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 24);
    const spots = await catalog.spots(assets);
    return Response.json({ spots });
  });
}
