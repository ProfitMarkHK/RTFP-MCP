import { describe, expect, test } from "bun:test";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient, type JsonRecord, type Transport } from "../src/client.js";
import {
  currentQuotes,
  latestSnapshots,
  recentTrades,
  toOptionValuations,
  toStatistics,
  toTrades,
} from "../src/market.js";

const noSleep = async (): Promise<void> => {};
const FUTURE_EXPIRY = 1766592000000000000n; // 2025-12-24T16:00:00Z

function scriptedClient(pagesByEndpoint: Record<string, unknown[]>): {
  client: RtfpClient;
  calls: { endpoint: string; params: Record<string, string | number> }[];
} {
  const calls: { endpoint: string; params: Record<string, string | number> }[] = [];
  const cursors = new Map<string, number>();
  const transport: Transport = async (url, params) => {
    const endpoint = url.replace(/^.*\//, "");
    calls.push({ endpoint, params });
    const pages = pagesByEndpoint[endpoint] ?? [];
    const index = Math.min(cursors.get(endpoint) ?? 0, pages.length - 1);
    cursors.set(endpoint, index + 1);
    return { status: 200, body: pages[index] ?? { result: [] } };
  };
  return { client: new RtfpClient({ transport, sleepMs: noSleep }), calls };
}

async function catalogOf(): Promise<InstrumentCatalog> {
  const transport: Transport = async () => ({
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
        options: [
          {
            type: "O",
            name: "BTCC-241225-90000",
            gfo_id: 6001,
            symbol: "GFBTO24122590000.00C",
            currency_multiplier: 10,
            strike_price: 900_000_000_000_000,
            call_put: "C",
            expiry: String(FUTURE_EXPIRY),
          },
        ],
        strategies: [],
      },
    },
  });
  return InstrumentCatalog.load(new RtfpClient({ transport, sleepMs: noSleep }));
}

describe("toTrades", () => {
  test("enriches raw trades with symbols and decoded timestamps", async () => {
    const catalog = await catalogOf();
    const records: JsonRecord[] = [
      {
        timestamp: 1739964606000000000n,
        contract_number: 5169,
        trade_id: "T1",
        aggressor_side: "B",
        quantity_executed: 2,
        trade_price: 74_260.5,
      },
      {
        timestamp: 1739964606000000001n,
        contract_number: 999999, // unknown contract
        trade_id: "T2",
        aggressor_side: "S",
        quantity_executed: 1,
        trade_price: 74_250,
      },
    ];
    const trades = toTrades(records, catalog);
    expect(trades[0]).toEqual({
      timestampIso: "2025-02-19T11:30:06Z",
      timestampUnixSec: 1739964606,
      symbol: "GFBTF241225",
      gfoId: 5169,
      tradeId: "T1",
      side: "B",
      quantity: 2,
      priceUsd: 74_260.5,
    });
    expect(trades[1]!.symbol).toBe("999999");
  });
});

describe("toStatistics and toOptionValuations", () => {
  test("decodes OHLC fields (already USD) and volume", async () => {
    const catalog = await catalogOf();
    const stats = toStatistics(
      [
        {
          timestamp: 1739964606000000000,
          contract_number: 5169,
          open_price: 74_000,
          high_price: 74_500,
          low_price: 73_900,
          last_price: 74_260.5,
          total_volume: 42,
          open_interest: 1000,
        },
      ],
      catalog,
    );
    expect(stats[0]!.symbol).toBe("GFBTF241225");
    expect(stats[0]!.lastUsd).toBe(74_260.5);
    expect(stats[0]!.totalVolume).toBe(42);
  });

  test("joins valuations with the catalog and unpacks greeks", async () => {
    const catalog = await catalogOf();
    const valuations = toOptionValuations(
      [
        {
          exchange_timestamp: 1739964606,
          contract_number: 6001,
          underlying_future_price: 74_260,
          option_price: 1234.5,
          option_implied_volatility: 0.91,
          option_greeks: { delta: 0.55, gamma: 0.0002, vega: 120.5 },
        },
        {
          exchange_timestamp: 1739964606,
          contract_number: 6001,
          underlying_future_price: null,
          option_price: null,
          option_greeks: null,
        },
      ],
      catalog,
    );
    expect(valuations[0]).toMatchObject({
      symbol: "GFBTO24122590000.00C",
      strikePriceUsd: 90_000,
      callPut: "C",
      impliedVolatility: 0.91,
      delta: 0.55,
      gamma: 0.0002,
      vega: 120.5,
    });
    expect(valuations[1]!.delta).toBeNull();
    expect(valuations[1]!.impliedVolatility).toBeNull();
  });
});

describe("latestSnapshots", () => {
  test("keeps the max-timestamp row per contract", () => {
    const snapshots = latestSnapshots([
      { contract_number: 5169, timestamp: 100, bids: [{ price: 1 }] },
      { contract_number: 5169, timestamp: 300, bids: [{ price: 3 }] },
      { contract_number: 6001, timestamp: 200, asks: [{ price: 2 }] },
    ]);
    expect(snapshots.size).toBe(2);
    expect((snapshots.get(5169) as JsonRecord).bids).toEqual([{ price: 3 }]);
  });
});

describe("currentQuotes", () => {
  test("widens to 300s only for contracts missing from the short window", async () => {
    const catalog = await catalogOf();
    const now = Math.floor(Date.now() / 1000);
    const shortBody = {
      result: [
        {
          contract_number: 5169,
          timestamp: (now - 2) * 1e9,
          bids: [{ price: 74_260 }],
          asks: [{ price: 74_270 }],
        },
      ],
      next: "",
    };
    const wideBody = { result: [], next: "" };
    const { client, calls } = scriptedClient({
      orderbook: [shortBody, wideBody, shortBody, wideBody],
    });

    const quotes = await currentQuotes(client, catalog);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      symbol: "GFBTF241225",
      bidUsd: 74_260,
      askUsd: 74_270,
      midUsd: 74_265,
    });
    // Short window first; the wide window only queried because the short
    // window covered the catalog (futures 5169 was quoted, so no widen needed).
    expect(calls[0]!.params.end_time - calls[0]!.params.start_time).toBeLessThanOrEqual(5);

    // Now a contract with no short-window quote forces the 300s widen.
    const emptyShort = { result: [], next: "" };
    const wideHit = {
      result: [
        {
          contract_number: 5169,
          timestamp: (now - 200) * 1e9,
          bids: [{ price: 74_000 }],
        },
      ],
      next: "",
    };
    const { client: client2, calls: calls2 } = scriptedClient({
      orderbook: [emptyShort, wideHit],
    });
    const quotes2 = await currentQuotes(client2, catalog);
    expect(quotes2[0]!.bidUsd).toBe(74_000);
    expect(quotes2[0]!.askUsd).toBeNull();
    expect(calls2[1]!.params.end_time - calls2[1]!.params.start_time).toBe(300);
  });
});

describe("recentTrades", () => {
  test("walks backward until n unique trade ids are collected", async () => {
    const catalog = await catalogOf();
    const trade = (id: string, offset: number): JsonRecord => ({
      timestamp: (Math.floor(Date.now() / 1000) - offset) * 1e9,
      contract_number: 5169,
      trade_id: id,
      trade_price: 74_000 + offset,
      quantity_executed: 1,
      aggressor_side: "B",
    });
    const { client, calls } = scriptedClient({
      trades: [
        { result: [trade("a", 10)], next: "" },
        { result: [trade("b", 320), trade("c", 330)], next: "" },
      ],
    });
    const trades = await recentTrades(client, catalog, 3, { maxWindows: 5 });
    expect(trades.map((t) => t.tradeId).sort()).toEqual(["a", "b", "c"]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Sorted newest first.
    expect(trades[0]!.priceUsd).toBeLessThan(trades[1]!.priceUsd);
  });

  test("stops after maxWindows even without enough trades", async () => {
    const catalog = await catalogOf();
    const { client, calls } = scriptedClient({ trades: [{ result: [], next: "" }] });
    const trades = await recentTrades(client, catalog, 10, { maxWindows: 3 });
    expect(trades).toEqual([]);
    expect(calls.length).toBe(3);
  });
});
