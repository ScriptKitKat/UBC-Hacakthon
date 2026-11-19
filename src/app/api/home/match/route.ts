import { isXUrl } from "@/features/catalog";
import { z } from "zod";
import { withHomeBody } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  text: z.string().trim().min(1).max(2000),
});

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async ({ text }, { desk }) => {
    const url = isXUrl(text) ? text.trim() : undefined;
    const match = await desk.matchPost({
      id: url ?? text.slice(0, 64),
      text,
      ...(url === undefined ? {} : { url }),
    });
    return Response.json(match);
  });
}
