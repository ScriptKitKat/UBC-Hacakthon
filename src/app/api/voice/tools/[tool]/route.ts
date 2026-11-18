import { withDesk } from "@/app/api/desk/route-helpers";
import { isVoiceToolName, loadVoiceEnv, runVoiceTool } from "@/features/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly tool: string }>;
}

async function readParameters(request: Request): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const text = await request.text();
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { tool } = await context.params;
  if (!isVoiceToolName(tool)) return Response.json({ error: "unknown-tool" }, { status: 404 });
  const parameters = await readParameters(request);
  if (!parameters.ok) {
    return Response.json(
      { status: "invalid-request", say: "I couldn't read that request.", issues: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const { operatorId } = loadVoiceEnv(process.env);
  return withDesk(async (desk) => {
    const result = await runVoiceTool({ desk, operatorId }, tool, parameters.value);
    return Response.json(result, { status: result.status === "invalid-request" ? 400 : 200 });
  });
}
