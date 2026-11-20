import { getDesk, getHomeServicesForRequest, releaseRuntimeAccess } from "@/features/desk";
import type { Desk, DeskAccess, HomeServices } from "@/features/desk";
import { StoreConflictError } from "@/features/storage";
import type { z } from "zod";

export async function withDesk(handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  const access = await getDesk();
  try {
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    return await handler(access.desk);
  } catch (error) {
    if (error instanceof StoreConflictError) return Response.json({ error: "store-conflict" }, { status: 503 });
    throw error;
  } finally {
    releaseRuntimeAccess(access);
  }
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

type DeskServices = Extract<DeskAccess, { ok: true }>;

export function withDashboardGet(request: Request, handler: (services: DeskServices) => Promise<Response>): Promise<Response> {
  return withDashboardServices(request, handler);
}

export async function withDashboardServices(request: Request, handler: (services: DeskServices) => Promise<Response>): Promise<Response> {
  if (!isDashboardRequest(request)) return forbidden();
  const access = await getDesk();
  try {
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    return await handler(access);
  } catch (error) {
    if (error instanceof StoreConflictError) return Response.json({ error: "store-conflict" }, { status: 503 });
    throw error;
  } finally {
    releaseRuntimeAccess(access);
  }
}

export function withDashboardPost(request: Request, handler: (desk: Desk) => Promise<Response>): Promise<Response> {
  if (!isDashboardRequest(request)) return Promise.resolve(forbidden());
  return withDesk(handler);
}

export async function withHomeGet(
  request: Request,
  handler: (services: Extract<HomeServices, { ok: true }>) => Promise<Response>,
): Promise<Response> {
  if (!isDashboardRequest(request)) return forbidden();
  const access = await getHomeServicesForRequest();
  try {
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    return await handler(access);
  } catch (error) {
    if (error instanceof StoreConflictError) return Response.json({ error: "store-conflict" }, { status: 503 });
    throw error;
  } finally {
    releaseRuntimeAccess(access);
  }
}

export async function withHomeBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  handler: (body: z.output<S>, services: Extract<HomeServices, { ok: true }>) => Promise<Response>,
): Promise<Response> {
  if (!isDashboardRequest(request)) return forbidden();
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
  const access = await getHomeServicesForRequest();
  try {
    if (!access.ok) return Response.json({ error: "desk-misconfigured", issues: access.issues }, { status: 503 });
    return await handler(parsed.data, access);
  } catch (error) {
    if (error instanceof StoreConflictError) return Response.json({ error: "store-conflict" }, { status: 503 });
    throw error;
  } finally {
    releaseRuntimeAccess(access);
  }
}
