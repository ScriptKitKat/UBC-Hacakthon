import { runCronTick } from "@/features/desk";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron-secret-not-configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runCronTick();
    if (summary === null) return Response.json({ error: "desk-unavailable" }, { status: 503 });
    return Response.json(summary);
  } catch {
    return Response.json({ error: "cron-tick-failed" }, { status: 500 });
  }
}
