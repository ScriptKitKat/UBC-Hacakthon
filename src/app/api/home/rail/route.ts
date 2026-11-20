import { railFromSnapshot } from "@/features/catalog";
import { homeRailSchema } from "@/shared";
import { withHomeGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ desk }) => {
    const snapshot = await desk.getSnapshot();
    return Response.json(homeRailSchema.parse(railFromSnapshot(snapshot)));
  });
}
