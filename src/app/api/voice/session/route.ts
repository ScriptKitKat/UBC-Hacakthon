import { createElevenLabsAdmin, loadVoiceEnv, openVoiceSession } from "@/features/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await openVoiceSession(loadVoiceEnv(process.env), (apiKey) => createElevenLabsAdmin({ apiKey, fetch }));
  if (session.ok) return Response.json(session.value);
  if (session.error.kind === "not-configured") {
    return Response.json({ error: "voice-not-configured", missing: session.error.missing }, { status: 503 });
  }
  return Response.json({ error: "voice-upstream-failed" }, { status: 502 });
}
