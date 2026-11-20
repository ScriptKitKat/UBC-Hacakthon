import { parsePortfolioRange } from "@/features/positions";
import { withDashboardGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const range = parsePortfolioRange(new URL(request.url).searchParams.get("range"));
  return withDashboardGet(request, async ({ desk }) => Response.json(await desk.getPortfolio(range)));
}
