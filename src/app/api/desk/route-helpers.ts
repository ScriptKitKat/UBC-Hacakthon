import { getDesk } from "@/features/desk";
import type { Desk } from "@/features/desk";
import type { z } from "zod";

export async function withDesk(handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  const access = await getDesk();
  if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
  return handler(access.desk);
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
