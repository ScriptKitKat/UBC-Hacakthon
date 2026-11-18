import { createHash, timingSafeEqual } from "node:crypto";
import { getXBot } from "@/features/xbot";
import type { XBot } from "@/features/xbot";
import type { z } from "zod";

export async function withBot(handler: (bot: XBot) => Promise<Response>): Promise<Response> {
  try {
    const access = await getXBot();
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    return await handler(access.bot);
  } catch {
    return Response.json({ error: "xbot-failed" }, { status: 500 });
  }
}

export async function withBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, bot: XBot) => Promise<Response>,
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
  return withBot((bot) => handler(parsed.data, bot));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hasValidWebhookToken(request: Request, expectedToken: string | undefined): boolean {
  if (expectedToken === undefined || expectedToken === "") return true;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(presented), digest(expectedToken));
}
