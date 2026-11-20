import { z } from "zod";
import { agentCycleReportSchema } from "@/shared";
import { withHomeBody } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ agentId: z.string().min(1).optional(), review: z.boolean().optional() }).strict();

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, body, async ({ agentId, review }, { catalog }) => {
    if (review === true && agentId === undefined) return Response.json({ error: "invalid-request" }, { status: 400 });
    if (agentId !== undefined) {
      const agent = await catalog.agents.store.get(agentId);
      if (agent === undefined) return Response.json({ error: "not-found" }, { status: 404 });
      if (agent.status === "paused") return Response.json({ error: "paused" }, { status: 409 });
    }
    const report = review === true
      ? await catalog.agents.run(agentId, { review: true, origin: "manual" })
      : await catalog.agents.run(agentId);
    return Response.json(agentCycleReportSchema.parse(report));
  });
}
