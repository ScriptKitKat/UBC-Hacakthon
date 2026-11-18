import { withBot } from "../route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): Promise<Response> {
  return withBot(async (bot) => {
    const summary = await bot.pollMentions();
    return Response.json(summary, { status: summary.error ? 502 : 200 });
  });
}
