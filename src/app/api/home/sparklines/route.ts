import { z } from "zod";
import { withHomeGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  symbols: z.string().min(1).max(800),
});

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const url = new URL(request.url);
    const parsed = query.safeParse({ symbols: url.searchParams.get("symbols") ?? undefined });
    if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
    const symbols = parsed.data.symbols.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    const sparklines = await catalog.sparklines(symbols);
    return Response.json({ sparklines });
  });
}
