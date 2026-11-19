import { briefLibraryViewSchema } from "@/shared";
import { withDashboardGet } from "../desk/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withDashboardGet(request, async ({ desk }) => {
    const view = await desk.listBriefLibrary();
    return Response.json(briefLibraryViewSchema.parse(view));
  });
}
