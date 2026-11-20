import { z } from "zod";
import { withHomeBody, withHomeGet } from "../../desk/route-helpers";
import { agentWriteBody, agentsPayload, patchFrom, rejectedModel } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().trim().min(1) });

export function GET(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  return withHomeGet(request, async (services) => {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) return Response.json({ error: "invalid-request", issues: ["id is required"] }, { status: 400 });
    const agent = await services.catalog.agents.store.get(parsed.data.id);
    if (agent === undefined) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ agent, ...(await agentsPayload(services)) });
  });
}

export function PATCH(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  return withHomeBody(request, agentWriteBody, async (input, services) => {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) return Response.json({ error: "invalid-request", issues: ["id is required"] }, { status: 400 });
    const blocked = rejectedModel(input.model);
    if (blocked) return blocked;
    if (await services.catalog.agents.store.get(parsed.data.id) === undefined) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const snapshot = await services.desk.getSnapshot();
    const patch = patchFrom(input, snapshot.policy.dailyCapCents);
    const status = patch.status;
    const rest = { ...patch };
    delete rest.status;
    if (Object.keys(rest).length > 0) {
      const updated = await services.catalog.agents.store.update(parsed.data.id, rest);
      if (updated === undefined) return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (status !== undefined) {
      const updated = await services.catalog.agents.store.setStatus(parsed.data.id, status);
      if (updated === undefined) return Response.json({ error: "not-found" }, { status: 404 });
    }
    return Response.json(await agentsPayload(services));
  });
}

export function DELETE(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  return withHomeBody(request, z.object({}).strict(), async (_input, services) => {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) return Response.json({ error: "invalid-request", issues: ["id is required"] }, { status: 400 });
    if (!await services.catalog.agents.store.remove(parsed.data.id)) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json(await agentsPayload(services));
  });
}
