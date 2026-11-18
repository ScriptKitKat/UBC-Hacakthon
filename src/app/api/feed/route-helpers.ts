import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { withBody, withDesk } from "../desk/route-helpers";
import type { Desk } from "@/features/desk";
import { corsHeaders, isAllowedOrigin } from "./cors";

const FORBIDDEN_ORIGIN = { error: "forbidden-origin" } as const;

function withCors(response: Response, origin: string | null): Response {
  if (origin !== null) {
    for (const [name, value] of Object.entries(corsHeaders(origin))) response.headers.set(name, value);
  }
  return response;
}

function isJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

async function guarded(request: Request, run: () => Promise<Response>): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin, process.env)) return Response.json(FORBIDDEN_ORIGIN, { status: 403 });
  try {
    return withCors(await run(), origin);
  } catch {
    return withCors(Response.json({ error: "feed-failed" }, { status: 500 }), origin);
  }
}

export function feedPreflight(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin === null || !isAllowedOrigin(origin, process.env)) return Response.json(FORBIDDEN_ORIGIN, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function feedGet(request: Request, handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  return guarded(request, () => withDesk(handler));
}

export function feedPost<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  return guarded(request, () =>
    isJson(request)
      ? withBody(request, schema, handler)
      : Promise.resolve(Response.json({ error: "unsupported-media-type", issues: ["content-type must be application/json"] }, { status: 415 })),
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function withPrewarmToken(request: Request, run: () => Promise<Response>): Promise<Response> {
  const token = process.env.FEED_PREWARM_TOKEN?.trim();
  if (token === undefined || token === "") return run();
  const presented = /^Bearer (.+)$/u.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!timingSafeEqual(digest(presented), digest(token))) {
    return Promise.resolve(Response.json({ error: "unauthorized" }, { status: 401 }));
  }
  return run();
}
