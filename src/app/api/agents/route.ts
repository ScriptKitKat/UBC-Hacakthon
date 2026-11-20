import { withHomeBody, withHomeGet } from "../desk/route-helpers";
import { agentCreateBody, agentsPayload, draftFrom, rejectedModel } from "./_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withHomeGet(request, async (services) => Response.json(await agentsPayload(services)));
}

export function POST(request: Request): Promise<Response> {
  return withHomeBody(request, agentCreateBody, async (input, services) => {
    const blocked = rejectedModel(input.model);
    if (blocked) return blocked;
    const snapshot = await services.desk.getSnapshot();
    await services.catalog.agents.store.create(draftFrom(input, snapshot.policy.dailyCapCents));
    return Response.json(await agentsPayload(services), { status: 201 });
  });
}
