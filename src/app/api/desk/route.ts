import { withDesk } from "./route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return withDesk(async (desk) => Response.json(await desk.getSnapshot()));
}
