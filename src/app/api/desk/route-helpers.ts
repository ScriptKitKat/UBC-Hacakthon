import { getDesk } from "@/features/desk";
import type { Desk } from "@/features/desk";
import type { Research } from "@/features/research";
import type { z } from "zod";

export async function withDesk(handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  return handler(access.desk);
}

function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function withBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid-request", issues: ["body must be valid JSON"] }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return Response.json({ error: "invalid-request", issues }, { status: 400 });
  }
  return withDesk((desk) => handler(parsed.data, desk));
}

export function withDashboardBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  if (isCrossOrigin(request)) return Promise.resolve(Response.json({ error: "cross-origin-forbidden" }, { status: 403 }));
  return withBody(request, schema, handler);
}

export async function withDashboardGet(
  request: Request,
  handler: (services: { readonly desk: Desk; readonly research: Research }) => Promise<Response>,
): Promise<Response> {
  if (isCrossOrigin(request)) return Response.json({ error: "cross-origin-forbidden" }, { status: 403 });
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  return handler(access);
}
