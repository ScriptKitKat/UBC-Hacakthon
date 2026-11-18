import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
});

try {
  const { createGeminiMarketsClient, formatCents } = await server.ssrLoadModule("/src/features/markets/index.ts");
  const baseUrl = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";
  const client = createGeminiMarketsClient({ baseUrl, fetch });

  const search = await client.searchEvents({ search: "FED", limit: 5 });
  if (!search.ok) {
    throw new Error(`searchEvents failed: ${JSON.stringify(search.error)}`);
  }
  console.log(`base=${baseUrl}`);
  console.log(`searchEvents(FED): ${String(search.value.events.length)} events, total=${String(search.value.total)}`);
  for (const event of search.value.events) {
    console.log(`  ${event.ticker} | ${event.title} | ${String(event.contracts.length)} contracts`);
  }

  const first = search.value.events[0];
  if (first === undefined) {
    throw new Error("no events returned for FED");
  }
  const detail = await client.getEvent(first.ticker);
  if (!detail.ok) {
    throw new Error(`getEvent failed: ${JSON.stringify(detail.error)}`);
  }
  console.log(`getEvent(${first.ticker}): ${detail.value.title}`);
  for (const contract of detail.value.contracts.slice(0, 5)) {
    const ask = contract.prices.buyYesCents;
    console.log(
      `  ${contract.instrumentSymbol} | ${contract.label} | ${contract.marketState} | yes ${ask === null ? "n/a" : formatCents(ask)}`,
    );
  }
  console.log("SMOKE OK");
} finally {
  await server.close();
}
