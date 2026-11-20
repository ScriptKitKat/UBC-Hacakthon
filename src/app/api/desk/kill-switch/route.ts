import { z } from "zod";
import { withDashboardBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ on: z.boolean() });

export function POST(request: Request): Promise<Response> {
  return withDashboardBody(request, body, async ({ on }, desk) => {
    await desk.setKillSwitch(on);
    return Response.json({ killSwitch: on });
  });
}
