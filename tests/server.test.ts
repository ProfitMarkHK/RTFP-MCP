import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient, type JsonRecord, type Transport } from "../src/client.js";
import { ServerContext, buildServer } from "../src/server.js";

const noSleep = async (): Promise<void> => {};
const FUTURE_EXPIRY = 1766592000000000000n;

/** Fake RTFP backing the whole server: one future, one option, one trade. */
function fakeTransport(): Transport {
  return async (url) => {
    const endpoint = url.replace(/^.*\//, "");
    switch (endpoint) {
      case "instrument_dict":
        return {
          status: 200,
          body: {
            result: {
              futures: [
                {
                  type: "F",
                  name: "BTCF-241225",
                  gfo_id: 5169,
                  symbol: "GFBTF241225",
                  currency_multiplier: 10,
                  expiry: String(FUTURE_EXPIRY),
                },
              ],
              options: [],
              strategies: [],
            },
          },
        };
      case "trades":
        return {
          status: 200,
          body: {
            result: [
              {
                timestamp: 1739964606000000000,
                contract_number: 5169,
                trade_id: "T1",
                aggressor_side: "B",
                quantity_executed: 2,
                trade_price: 74_260.5,
              },
            ],
            next: "",
          },
        };
      case "options_valuation":
        return { status: 200, body: { result: [], next: "" } };
      default:
        return { status: 200, body: { result: [], next: "" } };
    }
  };
}

let client: Client;
let cleanup: (() => Promise<void>) | undefined;

beforeEach(async () => {
  const context = new ServerContext(new RtfpClient({ transport: fakeTransport(), sleepMs: noSleep }));
  const server = buildServer(context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.1" });
  // Both sides must connect concurrently: the client's initialize handshake
  // only completes once the server transport is relaying.
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await cleanup?.();
});

function textOf(result: { content: { type: string; text?: string }[] }): unknown {
  const block = result.content.find((c) => c.type === "text");
  return JSON.parse((block?.text ?? "{}") as string);
}

describe("MCP server over the real protocol", () => {
  test("lists the full tool surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "get_instruments",
      "find_instrument",
      "get_recent_trades",
      "get_trades",
      "get_current_quotes",
      "get_orderbook",
      "get_statistics",
      "get_fulltick",
      "get_options_valuation",
      "black76_price",
      "black76_implied_vol",
    ]);
  });

  test("find_instrument resolves a symbol end to end", async () => {
    const result = await client.callTool({
      name: "find_instrument",
      arguments: { query: "GFBTF241225" },
    });
    const payload = textOf(result) as { found: boolean; gfoId?: number; expiryIso?: string };
    expect(payload.found).toBe(true);
    expect(payload.gfoId).toBe(5169);
    expect(payload.expiryIso).toBe("2025-12-24T16:00:00Z");
  });

  test("get_recent_trades decodes and enriches trades", async () => {
    const result = await client.callTool({
      name: "get_recent_trades",
      arguments: { n: 5 },
    });
    const payload = textOf(result) as { count: number; trades: JsonRecord[] };
    expect(payload.count).toBe(1);
    expect(payload.trades[0]!.symbol).toBe("GFBTF241225");
    expect(payload.trades[0]!.priceUsd).toBe(74_260.5);
  });

  test("get_trades chunks an ISO time range and stamps fetched_at", async () => {
    const result = await client.callTool({
      name: "get_trades",
      arguments: { start_time: "2025-02-19T11:00:00Z", end_time: "2025-02-19T11:10:00Z" },
    });
    const payload = textOf(result) as { count: number; fetched_at: string };
    // 10 minutes = two 300s windows; the fake transport answers each with
    // its single-trade page, proving the range was chunked and merged.
    expect(payload.count).toBe(2);
    expect(payload.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });

  test("get_trades rejects an unknown symbol with an MCP error result", async () => {
    const result = await client.callTool({
      name: "get_trades",
      arguments: { start_time: "2025-02-19T11:00:00Z", end_time: "2025-02-19T11:05:00Z", symbol: "NOPE" },
    });
    expect(result.isError).toBe(true);
    const block = result.content.find((c) => c.type === "text") as { text?: string };
    expect(block.text).toContain("unknown instrument: NOPE");
  });

  test("black76_price computes a put through the protocol", async () => {
    const result = await client.callTool({
      name: "black76_price",
      arguments: {
        future_price: 100,
        strike: 100,
        time_to_expiry_years: 1,
        rate: 0,
        volatility: 0.25,
        call_put: "P",
      },
    });
    const payload = textOf(result) as { priceUsd: number };
    // F = K with r = 0: put-call parity puts the put price at the call price.
    const call = await client.callTool({
      name: "black76_price",
      arguments: {
        future_price: 100,
        strike: 100,
        time_to_expiry_years: 1,
        rate: 0,
        volatility: 0.25,
        call_put: "C",
      },
    });
    const callPrice = (textOf(call) as { priceUsd: number }).priceUsd;
    expect(payload.priceUsd).toBeCloseTo(callPrice, 6);
    expect(payload.priceUsd).toBeGreaterThan(0);
  });

  test("black76_implied_vol round-trips through the protocol", async () => {
    const priced = await client.callTool({
      name: "black76_price",
      arguments: {
        future_price: 74_260,
        strike: 90_000,
        time_to_expiry_years: 0.5,
        rate: 0.05,
        volatility: 0.9,
        call_put: "C",
      },
    });
    const marketPrice = (textOf(priced) as { priceUsd: number }).priceUsd;
    const solved = await client.callTool({
      name: "black76_implied_vol",
      arguments: {
        future_price: 74_260,
        strike: 90_000,
        time_to_expiry_years: 0.5,
        rate: 0.05,
        call_put: "C",
        market_price: marketPrice,
      },
    });
    const payload = textOf(solved) as { impliedVolatility: number };
    expect(payload.impliedVolatility).toBeCloseTo(0.9, 3);
  });

  test("get_instruments serves the cached catalog without refetching", async () => {
    await client.callTool({ name: "get_instruments", arguments: {} });
    const second = await client.callTool({ name: "get_instruments", arguments: {} });
    const payload = textOf(second) as { futures: { symbol: string }[] };
    expect(payload.futures[0]!.symbol).toBe("GFBTF241225");
  });
});

describe("ServerContext catalog caching", () => {
  test("catalog is fetched once and reused across calls", async () => {
    let fetches = 0;
    const counting: Transport = async (url) => {
      const endpoint = url.replace(/^.*\//, "");
      if (endpoint === "instrument_dict") fetches++;
      return fakeTransport()(url, {}, 1000);
    };
    const context = new ServerContext(new RtfpClient({ transport: counting, sleepMs: noSleep }));
    await context.catalog();
    await context.catalog();
    expect(fetches).toBe(1);
    expect(await InstrumentCatalog.load(context.client)).toBeTruthy();
  });
});
