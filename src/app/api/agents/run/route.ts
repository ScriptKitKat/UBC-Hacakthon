import { z } from "zod";
import { agentCycleReportSchema } from "@/shared";
import { withHomeBody } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ agentId: z.string().min(1).optional() }).strict();

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async ({ agentId }, { catalog }) => {
    if (agentId !== undefined) {
      const agent = await catalog.agents.store.get(agentId);
      if (agent === undefined) return Response.json({ error: "not-found" }, { status: 404 });
      if (agent.status === "paused") return Response.json({ error: "paused" }, { status: 409 });
    }
    return Response.json(agentCycleReportSchema.parse(await catalog.agents.run(agentId)));
  });
}
