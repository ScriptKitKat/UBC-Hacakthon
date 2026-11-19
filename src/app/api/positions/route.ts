import { withDashboardGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withDashboardGet(request, async ({ desk }) => Response.json(await desk.getPositions()));
}
