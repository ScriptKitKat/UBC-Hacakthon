import { z } from "zod";
import { postBody, toPostInput } from "../post-body";
import { feedPost, feedPreflight, withPrewarmToken } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const MAX_PREWARM_POSTS = 25;

const body = z.object({ posts: z.array(postBody).min(1).max(MAX_PREWARM_POSTS) });

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return withPrewarmToken(request, () =>
    feedPost(request, body, async ({ posts }, desk) => {
      const matches = await Promise.all(posts.map((post) => desk.matchPost(toPostInput(post))));
      return Response.json({ warmed: matches.map(({ postId, kind }) => ({ postId, kind })) });
    }),
  );
}
