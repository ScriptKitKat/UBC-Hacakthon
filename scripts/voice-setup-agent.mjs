import { createElevenLabsAdmin, loadVoiceEnv, setupVoiceAgent } from "../src/features/voice/index.ts";

for (const envFile of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    continue;
  }
}

const env = loadVoiceEnv(process.env);
if (env.apiKey === undefined) {
  console.error("ELEVENLABS_API_KEY is missing. Add it to .env.local (or the environment) and run npm run voice:setup-agent again.");
  process.exit(1);
}

const admin = createElevenLabsAdmin({ apiKey: env.apiKey, fetch });
const result = await setupVoiceAgent(admin, env.agentId === undefined ? {} : { agentId: env.agentId });
if (!result.ok) {
  const { error } = result;
  const detail = error.kind === "http" ? `HTTP ${String(error.status)}${error.message === undefined ? "" : `: ${error.message}`}` : error.kind;
  console.error(`ElevenLabs setup failed (${detail}). Check ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.`);
  process.exit(1);
}

const { agentId, agentCreated, tools } = result.value;
console.log(`Agent ${agentCreated ? "created" : "updated"}: ${agentId}`);
console.log("Tools:");
for (const tool of tools) console.log(`  ${tool.name.padEnd(24)} ${tool.id}`);
console.log("");
console.log("Add this line to .env.local:");
console.log(`ELEVENLABS_AGENT_ID=${agentId}`);
