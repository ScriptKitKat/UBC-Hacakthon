import { z } from "zod";
import { feedPost, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  postId: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(2000),
  author: z.string().trim().min(1).max(100).optional(),
  url: z.url().optional(),
});

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return feedPost(request, body, async ({ postId, text, author }, desk) =>
    Response.json(await desk.matchPost({ id: postId, text, ...(author ? { author } : {}) })),
  );
}
