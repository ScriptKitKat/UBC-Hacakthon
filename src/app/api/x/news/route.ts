import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hasValidWebhookToken, withBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  text: z.string().trim().min(1).max(1000),
  authorHandle: z.string().trim().min(1).max(100),
  url: z.url().optional(),
});

export function POST(request: Request): Promise<Response> {
  if (!hasValidWebhookToken(request, process.env.XBOT_WEBHOOK_TOKEN?.trim())) {
    return Promise.resolve(Response.json({ error: "unauthorized" }, { status: 401 }));
  }
  return withBody(request, body, async ({ id, text, authorHandle, url }, bot) => {
    const result = await bot.ingestNewsPost({
      id: id ?? randomUUID(),
      text,
      authorHandle,
      postedAt: new Date(),
      ...(url ? { url } : {}),
    });
    return Response.json(result);
  });
}
