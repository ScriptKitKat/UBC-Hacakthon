import { railFromSnapshot } from "@/features/catalog";
import { homeViewSchema } from "@/shared";
import { z } from "zod";
import { withHomeGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["moving", "default"]).optional(),
  limit: z.coerce.number().int().positive().max(48).optional(),
});

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog, desk }) => {
    const url = new URL(request.url);
    const parsed = query.safeParse({
      search: url.searchParams.get("search") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
    const [listed, snapshot] = await Promise.all([catalog.list({
      sort: parsed.data.sort ?? "moving",
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    }), desk.getSnapshot()]);
    if (!listed.ok) return Response.json({ error: listed.reason }, { status: 502 });
    return Response.json(homeViewSchema.parse({ ...listed.page, rail: railFromSnapshot(snapshot) }));
  });
}
