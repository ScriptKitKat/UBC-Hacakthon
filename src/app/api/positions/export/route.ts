import { activityCsv, parsePortfolioRange } from "@/features/positions";
import { withDashboardGet } from "../../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const range = parsePortfolioRange(new URL(request.url).searchParams.get("range"));
  return withDashboardGet(request, async ({ desk }) => {
    const view = await desk.getPortfolio(range);
    return new Response(activityCsv(view.activity), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="portfolio-activity-${range}.csv"`,
      },
    });
  });
}
