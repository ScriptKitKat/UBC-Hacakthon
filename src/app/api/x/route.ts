import { withBot } from "./route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return withBot((bot) => Promise.resolve(Response.json({ status: bot.getStatus(), threads: bot.getThreads() })));
}
