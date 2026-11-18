import { postBody, toPostInput } from "../post-body";
import { feedPost, feedPreflight } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = feedPreflight;

export function POST(request: Request): Promise<Response> {
  return feedPost(request, postBody, async (body, desk) => Response.json(await desk.matchPost(toPostInput(body))));
}
