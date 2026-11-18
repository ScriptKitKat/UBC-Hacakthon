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

function jsonPost<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  return isJson(request)
    ? withBody(request, schema, handler)
    : Promise.resolve(Response.json({ error: "unsupported-media-type", issues: ["content-type must be application/json"] }, { status: 415 }));
}

export function feedPost<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  return guarded(request, () => jsonPost(request, schema, handler));
}

export function feedTradingPost<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, desk: Desk) => Promise<Response>,
): Promise<Response> {
  return guarded(request, async () => {
    const token = configuredToken("FEED_API_TOKEN");
    if (token === undefined) return Response.json({ error: "feed-trading-disabled" }, { status: 503 });
    return isBearer(request, token) ? jsonPost(request, schema, handler) : unauthorized();
  });
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function configuredToken(name: "FEED_API_TOKEN" | "FEED_PREWARM_TOKEN"): string | undefined {
  const token = process.env[name]?.trim();
  return token === undefined || token === "" ? undefined : token;
}

function isBearer(request: Request, token: string): boolean {
  const presented = /^Bearer (.+)$/u.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  return timingSafeEqual(digest(presented), digest(token));
}

export function withPrewarmToken(request: Request, run: () => Promise<Response>): Promise<Response> {
  const token = configuredToken("FEED_PREWARM_TOKEN");
  if (token === undefined) return run();
  return isBearer(request, token) ? run() : Promise.resolve(unauthorized());
}
