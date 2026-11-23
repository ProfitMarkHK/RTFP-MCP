/**
 * Live smoke tests against the real RTFP endpoints.
 *
 * Skipped unless RTFP_LIVE=1 (network + market-hours dependent):
 *   RTFP_LIVE=1 bun test tests/live.test.ts
 */

import { describe, expect, test } from "bun:test";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient } from "../src/client.js";
import { currentQuotes, recentTrades, toOptionValuations } from "../src/market.js";

const live = !!process.env.RTFP_LIVE;

// RTFP_BASE_URL lets the live suite run against any RTFP-shaped API,
// including the bundled look-alike (`bun run mock`).
const baseUrlOverride = process.env.RTFP_BASE_URL;

describe.skipIf(!live)("RTFP live endpoints", () => {
  const client = new RtfpClient({
    timeoutMs: 30_000,
    ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
  });

  test("instrument_dict returns a decoded catalog", async () => {
    const catalog = await InstrumentCatalog.load(client);
    expect(catalog.futures.length).toBeGreaterThan(0);
    expect(catalog.futures[0]!.symbol).toMatch(/^GF/);
    expect(catalog.futures[0]!.expiryIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("orderbook-based current quotes cover the futures strip", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const quotes = await currentQuotes(client, catalog);
    expect(quotes.length).toBeGreaterThan(0);
    for (const quote of quotes) {
      if (quote.bidUsd !== null && quote.askUsd !== null) {
        expect(quote.askUsd).toBeGreaterThanOrEqual(quote.bidUsd);
      }
    }
  });

  test("recent trades come back decoded when the market is active", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const trades = await recentTrades(client, catalog, 5, { maxWindows: 4 });
    // Off-hours markets may be quiet; the call itself must succeed.
    expect(Array.isArray(trades)).toBe(true);
    for (const trade of trades) {
      expect(trade.priceUsd).toBeGreaterThan(0);
      expect(trade.timestampIso).toMatch(/Z$/);
    }
  });

  test("options_valuation joins with the catalog", async () => {
    const catalog = await InstrumentCatalog.load(client);
    const records = await client.getPage("options_valuation", { underlying: "BTC" });
    const valuations = toOptionValuations(records, catalog);
    expect(valuations.length).toBeGreaterThan(0);
    const withGreeks = valuations.filter((v) => v.delta !== null);
    if (withGreeks.length > 0) {
      expect(Math.abs(withGreeks[0]!.delta!)).toBeLessThanOrEqual(1.01);
    }
  });
});
