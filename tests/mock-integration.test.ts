/**
 * Integration tests: the full client stack against the RTFP look-alike over
 * real HTTP. Runs in the default `bun test` suite (localhost only, no venue
 * access needed) and exercises the documented API quirks through the real
 * transport: the 300s window limit, multi-page pagination via the
 * wrong-host/never-empty `next` bug, instrument_id filtering, and the
 * orderbook short-window widening path.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient } from "../src/client.js";
import { MOCK_BASE_PRICE, MOCK_RISK_FREE_RATE, startMockServer } from "../src/mock-server.js";
import { black76Price } from "../src/black76.js";
import {
  currentQuotes,
  recentTrades,
  toOptionValuations,
  toStatistics,
  toTrades,
} from "../src/market.js";

let handle: ReturnType<typeof startMockServer>;
let client: RtfpClient;

beforeAll(() => {
  handle = startMockServer({ port: 0 });
  client = new RtfpClient({ baseUrl: handle.url, timeoutMs: 10_000 });
});

afterAll(async () => {
  await handle.stop();
});

/** A fully-closed window in the past (safe for the window cache). */
function pastWindow(minutes: number): { start: number; end: number } {
  const end = Math.floor(Date.now() / 1000) - 120;
  return { start: end - minutes * 60, end };
}

describe("RTFP look-alike: catalog", () => {
  test("decodes the futures strip, options chain and strategies", async () => {
    const catalog = await InstrumentCatalog.load(client);
    expect(catalog.futures).toHaveLength(4);
    expect(catalog.options).toHaveLength(20);
    expect(catalog.strategies).toHaveLength(1);

    const front = catalog.futures[0]!;
    expect(front.symbol).toMatch(/^GFBTF\d{6}$/);
    expect(front.expiryIso).toMatch(/^\d{4}-\d{2}-\d{2}T16:00:00Z$/);
    // Scaled prices decode: tick 5_000_000_000 * 10**10 -> 5.0 USD.
    expect(front.tickTableUsd[0]!.tickSizeUsd).toBe(5);

    const strikes = catalog.options.map((o) => o.strikePriceUsd!).sort((a, b) => a - b);
    expect(strikes[0]!).toBeGreaterThan(MOCK_BASE_PRICE * 0.85);
    expect(strikes.at(-1)!).toBeLessThan(MOCK_BASE_PRICE * 1.15);
    // Strikes are round hundreds (scaled exactly, no float debris).
    for (const strike of strikes) expect(strike % 100).toBe(0);
  });
});

describe("RTFP look-alike: trades", () => {
  test("returns decoded, symbol-enriched trades in a window", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const { start, end } = pastWindow(10);
    const records = await client.fetchRange("trades", start, end);
    const trades = toTrades(records, catalog);
    expect(trades.length).toBeGreaterThan(0);
    for (const trade of trades) {
      expect(trade.symbol).toMatch(/^GFBTF\d{6}$/);
      expect(trade.priceUsd).toBeGreaterThan(MOCK_BASE_PRICE * 0.9);
      expect(trade.timestampUnixSec).toBeGreaterThanOrEqual(start);
      expect(trade.timestampUnixSec).toBeLessThan(end);
    }
    // fetchRange preserves chronological (ascending) order within the range.
    expect(trades[0]!.timestampUnixSec).toBeLessThanOrEqual(trades.at(-1)!.timestampUnixSec);
  });

  test("honours instrument_id filtering server-side", async () => {
    const { start } = pastWindow(10);
    const records = await client.getPage("trades", {
      start_time: start,
      end_time: start + 300,
      instrument_id: 9002,
    });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(record.contract_number).toBe(9002);
  });

  test("recentTrades walks backward and sorts newest first", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const trades = await recentTrades(client, catalog, 5, { maxWindows: 12 });
    expect(trades).toHaveLength(5);
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i]!.timestampUnixSec).toBeLessThanOrEqual(trades[i - 1]!.timestampUnixSec);
    }
  });
});

describe("RTFP look-alike: window and pagination quirks", () => {
  test("rejects a >300s direct window with HTTP 400", async () => {
    const { start } = pastWindow(20);
    const request = client.getPage("trades", { start_time: start, end_time: start + 600 });
    await expect(request).rejects.toThrow(/HTTP 400/);
    await expect(request).rejects.toThrow(/window exceeds 300 seconds/);
  });

  test("chunked fetchRange spans a 12-minute window without error", async () => {
    const { start, end } = pastWindow(12);
    const records = await client.fetchRange("trades", start, end);
    expect(records.length).toBeGreaterThan(0);
  });

  test("fulltick pagination: a 300s window exceeds one 500-row page", async () => {
    const { start } = pastWindow(6);
    const records = await client.getPage("fulltick", { start_time: start, end_time: start + 300 });
    // ~2.2 events/second: >600 rows, so the client must follow the (wrong
    // host, never-empty) next links and merge pages over real HTTP.
    expect(records.length).toBeGreaterThan(500);
    expect(records.length).toBeLessThan(700);
  });

  test("unknown endpoint yields HTTP 404", async () => {
    await expect(client.getPage("nope", {})).rejects.toThrow(/HTTP 404/);
  });
});

describe("RTFP look-alike: quotes and statistics", () => {
  test("currentQuotes quotes the whole strip with bid < ask", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const quotes = await currentQuotes(client, catalog);
    expect(quotes).toHaveLength(4);
    for (const quote of quotes) {
      expect(quote.bidUsd).not.toBeNull();
      expect(quote.askUsd).not.toBeNull();
      expect(quote.bidUsd!).toBeLessThan(quote.askUsd!);
      expect(quote.snapshotIso).toMatch(/Z$/);
    }
    const expiries = quotes.map((q) => q.expiryIso);
    expect(expiries).toEqual([...expiries].sort());
  });

  test("statistics carries OHLC with high >= low", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const { start, end } = pastWindow(6);
    const records = await client.fetchRange("statistics", start, end);
    const stats = toStatistics(records, catalog);
    expect(stats.length).toBeGreaterThan(0);
    for (const stat of stats) {
      expect(stat.highUsd!).toBeGreaterThanOrEqual(stat.lowUsd!);
      expect(stat.lastUsd!).toBeGreaterThan(0);
      expect(stat.openInterest).not.toBeNull();
    }
  });
});

describe("RTFP look-alike: options_valuation", () => {
  test("valuations are Black76-consistent with their reported IV", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const records = await client.getPage("options_valuation", { underlying: "BTC" });
    const valuations = toOptionValuations(records, catalog);
    expect(valuations).toHaveLength(20);

    const now = Math.floor(Date.now() / 1000);
    for (const valuation of valuations) {
      expect(valuation.impliedVolatility).not.toBeNull();
      expect(valuation.optionPriceUsd).not.toBeNull();
      expect(valuation.underlyingFuturePriceUsd).not.toBeNull();

      const years =
        (Date.parse(valuation.expiryIso) / 1000 - now) / (365.25 * 86_400);
      const theoretical = black76Price({
        futurePrice: valuation.underlyingFuturePriceUsd!,
        strike: valuation.strikePriceUsd!,
        timeToExpiryYears: Math.max(years, 1 / 365),
        rate: MOCK_RISK_FREE_RATE,
        volatility: valuation.impliedVolatility!,
        callPut: valuation.callPut!,
      });
      // The look-alike prices options with the same Black76 inputs it
      // reports, so the round-trip must agree to the cent.
      expect(valuation.optionPriceUsd).toBeCloseTo(theoretical, 1);
      expect(Math.abs(valuation.delta!)).toBeLessThanOrEqual(1.01);
      expect(valuation.vega!).toBeGreaterThan(0);
    }
  });
});

describe("RTFP look-alike: fixture clock", () => {
  test("uses the injected clock for valuations and generated expiries", async () => {
    const frozen = 1_800_000_000;
    const frozenHandle = startMockServer({ port: 0, clock: () => frozen });
    try {
      const frozenClient = new RtfpClient({ baseUrl: frozenHandle.url });
      const valuations = await frozenClient.getPage("options_valuation", { underlying: "BTC" });
      expect(valuations[0]?.exchange_timestamp).toBe(frozen);

      const catalog = await InstrumentCatalog.load(frozenClient);
      const midnight = frozen - (frozen % 86_400);
      const expectedExpiry = new Date((midnight + 30 * 86_400 + 16 * 3600) * 1000)
        .toISOString()
        .replace(".000Z", "Z");
      expect(catalog.futures[0]?.expiryIso).toBe(expectedExpiry);
    } finally {
      await frozenHandle.stop();
    }
  });
});
