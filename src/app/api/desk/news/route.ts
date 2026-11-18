import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  text: z.string().trim().min(1).max(1000),
  url: z.url().optional(),
  author: z.string().trim().min(1).max(100).optional(),
});

export function POST(request: Request): Promise<Response> {
  return withBody(request, body, async ({ text, url, author }, desk) => {
    const match = await desk.submitNews({
      id: randomUUID(),
      text,
      postedAt: new Date(),
      ...(url ? { url } : {}),
      ...(author ? { author } : {}),
    });
    return Response.json({ match });
  });
}
