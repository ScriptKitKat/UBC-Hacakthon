import { browsePageSchema, browseSortSchema } from "@/shared";
import { z } from "zod";
import { withHomeGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  sort: browseSortSchema.optional(),
  offset: z.coerce.number().int().nonnegative().max(96).optional(),
  limit: z.coerce.number().int().positive().max(96).optional(),
});

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const url = new URL(request.url);
    const parsed = query.safeParse({
      search: url.searchParams.get("search") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
    const listed = await catalog.browse({
      sort: parsed.data.sort ?? "trending",
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
      ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }),
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    });
    if (!listed.ok) return Response.json({ error: listed.reason }, { status: 502 });
    return Response.json(browsePageSchema.parse(listed.page));
  });
}
