import { describe, expect, test } from "bun:test";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient, type JsonRecord, type Transport } from "../src/client.js";
import { queryRange, type RangeQueryDeps } from "../src/range-query.js";
import type { Clock } from "../src/query-window.js";

const FROZEN = 1_800_000_000.456;
const EXPECTED_FETCHED_AT = "2027-01-15T08:00:00.456Z";
const TRADE_TS = 1_739_964_606_000_000_000;

interface Call {
  endpoint: string;
  params: Record<string, string | number>;
}

const instruments = {
  result: {
    futures: [
      {
        type: "F",
        name: "BTCF-241225",
        gfo_id: 5169,
        symbol: "GFBTF241225",
        currency_multiplier: 10,
        expiry: String(1_766_592_000_000_000_000n),
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
        expiry: String(1_766_592_000_000_000_000n),
      },
    ],
    strategies: [],
  },
};

const trade: JsonRecord = {
  timestamp: TRADE_TS + 2,
  contract_number: 5169,
  trade_id: "T1",
  aggressor_side: "B",
  quantity_executed: 2,
  trade_price: 74_260.5,
};

const snapshot: JsonRecord = {
  timestamp: TRADE_TS,
  contract_number: 5169,
  state: "O",
  num_of_bids: 2,
  num_of_asks: 2,
  bids: [
    { quantity: 5, price: 74_260 },
    { quantity: 8, price: 74_255 },
  ],
  asks: [
    { quantity: 3, price: 74_270 },
    { quantity: 6, price: 74_275 },
  ],
  full_tick_reference_sequence: 42,
};

const statistic: JsonRecord = {
  timestamp: TRADE_TS,
  contract_number: 5169,
  open_price: 74_100,
  high_price: 74_310,
  low_price: 74_050,
  last_price: 74_265,
  reference_price: 74_260,
  total_volume: 152,
  open_interest: 1250,
};

const events: JsonRecord[] = [
  {
    timestamp: TRADE_TS + 1,
    contract_number: 5169,
    message_type: "A",
    order_id: "O-1",
    volume: 4,
    price: 74_258,
    side: "B",
    type: "D",
  },
  {
    timestamp: TRADE_TS + 2,
    contract_number: 5169,
    message_type: "D",
    order_id: "O-1",
    side: "B",
    remaining: 1,
  },
  {
    timestamp: TRADE_TS + 3,
    contract_number: 5169,
    message_type: "O", // spec sample: timestamp, contract_number, volume, price only
    volume: 0.001,
    price: 74_261,
  },
  {
    timestamp: TRADE_TS + 4,
    contract_number: 5169,
    message_type: "S",
    price: 74_262,
  },
  {
    timestamp: TRADE_TS + 5,
    contract_number: 5169,
    message_type: "T",
    state: "O",
  },
];

const valuation: JsonRecord = {
  exchange_timestamp: 1_739_964_606,
  contract_number: 6001,
  underlying_future_price: 74_260,
  option_price: 1234.5,
  option_implied_volatility: 0.91,
  option_greeks: { delta: 0.55, gamma: 0.00021, vega: 120.5 },
};

/** Fake shell: scripted pages plus a session-cached catalog, as ServerContext does. */
function makeDeps(clock: Clock = () => FROZEN): { deps: RangeQueryDeps; calls: Call[] } {
  const calls: Call[] = [];
  const pages: Record<string, JsonRecord[][]> = {
    trades: [[trade]],
    orderbook: [[snapshot]],
    statistics: [[statistic]],
    fulltick: [events],
    options_valuation: [[valuation]],
  };
  const cursors = new Map<string, number>();
  const transport: Transport = async (url, params) => {
    const endpoint = url.replace(/^.*\//, "");
    calls.push({ endpoint, params });
    if (endpoint === "instrument_dict") return { status: 200, body: instruments };
    const pageRows = pages[endpoint] ?? [];
    const index = Math.min(cursors.get(endpoint) ?? 0, pageRows.length - 1);
    cursors.set(endpoint, index + 1);
    return { status: 200, body: { result: pageRows[index] ?? [], next: "" } };
  };
  const client = new RtfpClient({ transport, sleepMs: async () => {}, clock });
  let catalog: Promise<InstrumentCatalog> | undefined;
  return {
    calls,
    deps: {
      client,
      clock,
      catalog: () => {
        catalog ??= InstrumentCatalog.load(client);
        return catalog;
      },
    },
  };
}

const range = {
  start: "2025-02-19T11:00:00Z",
  end: "2025-02-19T11:05:00Z",
  underlying: "BTC",
} as const;

describe("queryRange: decoded values for every kind", () => {
  test("trades: decodes timestamps, enriches symbols and chunks the range", async () => {
    const { deps } = makeDeps();
    const result = await queryRange(deps, { kind: "trades", ...range });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fetchedAt).toBe(EXPECTED_FETCHED_AT);
    expect(result.value).toEqual([
      {
        timestampIso: "2025-02-19T11:30:06Z",
        timestampUnixSec: 1_739_964_606,
        symbol: "GFBTF241225",
        gfoId: 5169,
        tradeId: "T1",
        side: "B",
        quantity: 2,
        priceUsd: 74_260.5,
      },
    ]);
    // Ten minutes spans two 300s windows behind the seam.
    const chunked = makeDeps();
    const chunkedResult = await queryRange(chunked.deps, {
      kind: "trades",
      ...range,
      end: "2025-02-19T11:10:00Z",
    });
    expect(chunkedResult.ok).toBe(true);
    expect(chunked.calls.filter((call) => call.endpoint === "trades")).toHaveLength(2);
  });

  test("orderbook: decodes every wire field without dropping levels or sequence", async () => {
    const { deps } = makeDeps();
    const result = await queryRange(deps, { kind: "orderbook", ...range });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        snapshotIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        state: "O",
        numBids: 2,
        numAsks: 2,
        bids: [
          { quantity: 5, priceUsd: 74_260 },
          { quantity: 8, priceUsd: 74_255 },
        ],
        asks: [
          { quantity: 3, priceUsd: 74_270 },
          { quantity: 6, priceUsd: 74_275 },
        ],
        fullTickReferenceSequence: 42,
      },
    ]);
  });

  test("statistics: keeps USD OHLC fields and the catalog symbol", async () => {
    const { deps } = makeDeps();
    const result = await queryRange(deps, { kind: "statistics", ...range });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject([
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        openUsd: 74_100,
        highUsd: 74_310,
        lowUsd: 74_050,
        lastUsd: 74_265,
        totalVolume: 152,
        openInterest: 1250,
      },
    ]);
  });

  test("fulltick: returns one variant per message type with only its own fields", async () => {
    const { deps } = makeDeps();
    const result = await queryRange(deps, { kind: "fulltick", ...range });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        messageType: "A",
        orderId: "O-1",
        volume: 4,
        priceUsd: 74_258,
        side: "B",
        orderType: "D",
      },
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        messageType: "D",
        orderId: "O-1",
        side: "B",
        remaining: 1,
      },
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        messageType: "O",
        volume: 0.001,
        priceUsd: 74_261,
      },
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        messageType: "S",
        priceUsd: 74_262,
      },
      {
        timestampIso: "2025-02-19T11:30:06Z",
        symbol: "GFBTF241225",
        gfoId: 5169,
        messageType: "T",
        state: "O",
      },
    ]);
    expect(result.fetchedAt).toBe(EXPECTED_FETCHED_AT);
  });

  test("options_valuation: decodes plain-seconds timestamps and joins the catalog", async () => {
    const { deps, calls } = makeDeps();
    const result = await queryRange(deps, { kind: "options_valuation", underlying: "BTC" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject([
      {
        symbol: "GFBTO24122590000.00C",
        gfoId: 6001,
        strikePriceUsd: 90_000,
        callPut: "C",
        exchangeTimestampIso: "2025-02-19T11:30:06Z",
        optionPriceUsd: 1234.5,
        impliedVolatility: 0.91,
        delta: 0.55,
        gamma: 0.00021,
        vega: 120.5,
      },
    ]);
    expect(calls.map((call) => call.endpoint)).toEqual(["instrument_dict", "options_valuation"]);
  });
});

describe("queryRange: seam behaviour", () => {
  test("resolves a symbol, or sends an explicit instrument_id", async () => {
    const bySymbol = makeDeps();
    const symbolResult = await queryRange(bySymbol.deps, {
      kind: "statistics",
      ...range,
      symbol: "GFBTF241225",
    });
    expect(symbolResult.ok).toBe(true);
    expect(bySymbol.calls.find((call) => call.endpoint === "statistics")?.params).toMatchObject({
      underlying: "BTC",
      instrument_id: 5169,
    });

    const byId = makeDeps();
    const idResult = await queryRange(byId.deps, {
      kind: "statistics",
      ...range,
      instrumentId: 9002,
    });
    expect(idResult.ok).toBe(true);
    expect(byId.calls.find((call) => call.endpoint === "statistics")?.params).toMatchObject({
      underlying: "BTC",
      instrument_id: 9002,
    });
  });

  test("stamps fetched_at from the injected clock on success", async () => {
    const at = Date.parse("2026-01-15T12:34:56.789Z") / 1000;
    const { deps } = makeDeps(() => at);
    const result = await queryRange(deps, { kind: "trades", ...range });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fetchedAt).toBe("2026-01-15T12:34:56.789Z");
  });

  test("returns tagged failures with the shared validation messages", async () => {
    const { deps } = makeDeps();
    const inverted = await queryRange(deps, {
      kind: "trades",
      ...range,
      end: range.start,
    });
    expect(inverted).toEqual({
      ok: false,
      error: "end_time must be after start_time",
    });

    const tooLarge = await queryRange(deps, {
      kind: "trades",
      ...range,
      end: "2025-02-20T11:05:00Z",
    });
    expect(tooLarge).toEqual({
      ok: false,
      error:
        "time range exceeds 86400s; split into smaller ranges " +
        "(the API allows 300s windows, this server chunks them for you)",
    });

    const unknown = await queryRange(deps, { kind: "trades", ...range, symbol: "NOPE" });
    expect(unknown).toEqual({ ok: false, error: "unknown instrument: NOPE" });
  });
});
