import { agentCycleReportSchema } from "@/shared";
import { z } from "zod";
import { withHomeBody } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({}).strict();

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async (_input, { catalog }) => {
    return Response.json(agentCycleReportSchema.parse(await catalog.agents.run()));
  });
}
