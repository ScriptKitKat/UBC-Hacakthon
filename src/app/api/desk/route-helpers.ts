import { getDesk } from "@/features/desk";
import type { Desk } from "@/features/desk";
import type { Research } from "@/features/research";
import type { z } from "zod";

export async function withDesk(handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  return handler(access.desk);
}

function isDashboardRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return request.headers.get("sec-fetch-site") === "same-origin";
  const claimed = URL.parse(origin);
  const own = URL.parse(request.url);
  return claimed !== null && own !== null && claimed.origin !== "null" && claimed.origin === own.origin;
}

function forbidden(): Response {
  return Response.json({ error: "cross-origin-forbidden" }, { status: 403 });
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
  if (!isDashboardRequest(request)) return Promise.resolve(forbidden());
  return withBody(request, schema, handler);
}

export async function withDashboardGet(
  request: Request,
  handler: (services: { readonly desk: Desk; readonly research: Research }) => Promise<Response>,
): Promise<Response> {
  if (!isDashboardRequest(request)) return forbidden();
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  return handler(access);
}

export function withDashboardPost(request: Request, handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  if (!isDashboardRequest(request)) return Promise.resolve(forbidden());
  return withDesk(handler);
}
