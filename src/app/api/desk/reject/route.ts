import { z } from "zod";
import { withDashboardBody } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ intentId: z.string().min(1), approverId: z.string().trim().min(1) });

export function POST(request: Request): Promise<Response> {
  return withDashboardBody(request, body, async ({ intentId, approverId }, desk) => {
    const result = await desk.rejectPending(intentId, approverId);
    if (result.ok) return Response.json({ entry: result.entry });
    const status = result.error === "unauthorized-approver" ? 403 : 404;
    return Response.json({ error: result.error }, { status });
  });
}
