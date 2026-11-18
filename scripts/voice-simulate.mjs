const baseUrl = (process.argv[2] ?? process.env.VOICE_SIM_BASE_URL ?? "http://localhost:3000").replace(/\/+$/u, "");
const NEWS_HEADLINE = "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says";

const mismatches = [];

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { httpStatus: response.status, body: await response.json() };
}

function user(text) {
  console.log(`\nUSER   : ${text}`);
}

function agent(text) {
  console.log(`AGENT  : ${text}`);
}

async function toolCall(name, parameters, expectedStatus) {
  console.log(`TOOL   > ${name}(${JSON.stringify(parameters)})`);
  const { httpStatus, body } = await post(`/api/voice/tools/${name}`, parameters);
  console.log(`TOOL   < HTTP ${String(httpStatus)} status=${String(body.status)}`);
  if (body.status !== expectedStatus) mismatches.push(`${name}: expected ${expectedStatus}, got ${String(body.status)}`);
  agent(String(body.say));
  return body;
}

console.log(`Voice desk simulation against ${baseUrl}`);

user("(a Fed headline hits the news feed)");
const news = await post("/api/desk/news", { text: NEWS_HEADLINE, author: "voice-simulation" });
console.log(`NEWS   > ${NEWS_HEADLINE}`);
console.log(`NEWS   < HTTP ${String(news.httpStatus)} match=${String(news.body.match?.kind)}`);

user("What's the market saying about the Fed?");
await toolCall("get_market_quote", {}, "quote");

user("Sure, put one dollar on yes.");
agent("Confirming: 1 dollar on yes. Placing it now.");
await toolCall("propose_trade", { outcome: "yes", amount_usd: 1 }, "placed");

user("Let's go bigger: five dollars on yes.");
agent("Confirming: 5 dollars on yes. Placing it now.");
await toolCall("propose_trade", { outcome: "yes", amount_usd: 5 }, "needs-approval");

user("Yes, approve it.");
await toolCall("approve_pending_trade", {}, "placed");

user("Put fifty dollars on yes.");
agent("Confirming: 50 dollars on yes. Placing it now.");
await toolCall("propose_trade", { outcome: "yes", amount_usd: 50 }, "refused");

user("How much budget do I have left?");
await toolCall("get_desk_status", {}, "desk-status");

user("Put -3 dollars on yes.");
await toolCall("propose_trade", { outcome: "yes", amount_usd: -3 }, "invalid-request");

console.log("");
if (mismatches.length > 0) {
  console.error(`SIMULATION FAILED:\n  ${mismatches.join("\n  ")}`);
  process.exit(1);
}
console.log("SIMULATION OK: every tool returned the expected status.");
