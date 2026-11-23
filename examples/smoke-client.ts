/**
 * Stdio end-to-end smoke client.
 *
 * Spawns rtfp-mcp as a real subprocess (the way an MCP host would), performs
 * the MCP handshake over stdio, and exercises the tools.
 *
 *   RTFP_MOCK=1  bun run examples/smoke-client.ts  # local RTFP look-alike over real HTTP
 *                                             # (`bun run mock` must be running)
 *   RTFP_DEMO=1  bun run examples/smoke-client.ts  # canned data, offline
 *   RTFP_LIVE=1  bun run examples/smoke-client.ts  # real GFO-X endpoints
 *                                                  # (office network / VPN)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mode =
  process.env.RTFP_LIVE === "1" ? "live" : process.env.RTFP_MOCK === "1" ? "mock" : "demo";
console.log(`smoke: spawning rtfp-mcp over stdio (${mode} data)`);

const env: Record<string, string> = { ...process.env } as Record<string, string>;
env.RTFP_MOCK = mode === "mock" ? "1" : "";
env.RTFP_DEMO = mode === "demo" ? "1" : "";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/index.ts"],
  env,
});
const client = new Client({ name: "smoke-client", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`smoke: ${tools.length} tools listed:`);
for (const tool of tools) console.log(`  - ${tool.name}`);

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const block = result.content.find((c) => c.type === "text") as { text?: string };
  if (result.isError) throw new Error(`smoke: ${name} -> MCP error: ${block?.text}`);
  return JSON.parse(block.text ?? "{}");
}

const instrument = (await call("find_instrument", { query: "GFBTF" })) as {
  found?: boolean;
  symbol?: string;
  gfoId?: number;
};
console.log(
  `smoke: find_instrument(GFBTF) -> ${instrument.found ? `${instrument.symbol} (gfo_id ${instrument.gfoId})` : "not found"}`,
);

const quotes = (await call("get_current_quotes", {})) as {
  quotes: { symbol: string; bidUsd: number | null; askUsd: number | null }[];
};
for (const quote of quotes.quotes) {
  console.log(`smoke: quote ${quote.symbol} bid=${quote.bidUsd} ask=${quote.askUsd}`);
}

const trades = (await call("get_recent_trades", { n: 3 })) as {
  trades: { symbol: string; priceUsd: number; timestampIso: string }[];
};
for (const trade of trades.trades) {
  console.log(`smoke: trade ${trade.symbol} @ ${trade.priceUsd} at ${trade.timestampIso}`);
}

const valuations = (await call("get_options_valuation", {})) as {
  valuations: { symbol: string; impliedVolatility: number | null; delta: number | null }[];
};
for (const valuation of valuations.valuations) {
  console.log(
    `smoke: option ${valuation.symbol} IV=${valuation.impliedVolatility} delta=${valuation.delta}`,
  );
}

const priced = (await call("black76_price", {
  future_price: 74_260,
  strike: 90_000,
  time_to_expiry_years: 0.5,
  rate: 0.05,
  volatility: 0.91,
  call_put: "C",
})) as { priceUsd: number };
console.log(`smoke: black76_price -> $${priced.priceUsd.toFixed(2)}`);

const solved = (await call("black76_implied_vol", {
  future_price: 74_260,
  strike: 90_000,
  time_to_expiry_years: 0.5,
  rate: 0.05,
  call_put: "C",
  market_price: priced.priceUsd,
})) as { impliedVolatility: number | null };
console.log(`smoke: black76_implied_vol round-trip -> ${solved.impliedVolatility?.toFixed(3)}`);

await client.close();
console.log("smoke: OK");
