import { agentActivityViewSchema } from "@/shared";
import { withHomeGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async ({ catalog }) => {
    const agents = await catalog.agents.store.list();
    const activity = agents
      .flatMap((agent) => agent.activity.map((entry) => ({
        ...entry,
        agentId: agent.id,
        agentName: agent.name,
        eventTicker: agent.eventTicker,
      })))
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, 100);
    return Response.json(agentActivityViewSchema.parse({ activity }));
  });
}
