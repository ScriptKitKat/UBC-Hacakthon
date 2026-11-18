import { z } from "zod";
import { withBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ intentId: z.string().min(1), approverId: z.string().trim().min(1) });

export function POST(request: Request): Promise<Response> {
  return withBody(request, body, async ({ intentId, approverId }, desk) => {
    const result = await desk.confirmPending(intentId, approverId);
    return result.ok ? Response.json({ entry: result.entry }) : Response.json({ error: result.error }, { status: 404 });
  });
}
