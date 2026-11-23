/**
 * MCP server: exposes the RTFP market data workflows as tools.
 *
 * Uses Anthropic's Model Context Protocol SDK (McpServer high-level API).
 * Every tool returns human-readable JSON text so any MCP client can consume
 * the results, and stamps `fetched_at` so freshness is always disclosed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { InstrumentCatalog, type DecodedInstrument } from "./catalog.js";
import { RtfpClient } from "./client.js";
import { black76ImpliedVol, black76Price } from "./black76.js";
import { realClock } from "./clock.js";
import { currentQuotes, recentTrades } from "./market.js";
import { queryRange, stampFetchedAt } from "./range-query.js";
import type { Clock } from "./query-window.js";

const timeValue = z.union([z.string(), z.number()]).describe(
  "ISO-8601 timestamp or Unix seconds. Bare ISO strings are interpreted as London local time.",
);

export class ServerContext {
  readonly client: RtfpClient;
  readonly clock: Clock;
  private readonly catalogs = new Map<string, Promise<InstrumentCatalog>>();

  constructor(client: RtfpClient, clock: Clock = realClock) {
    this.client = client;
    this.clock = clock;
  }

  /** Freshness stamp from the shared clock, with millisecond precision. */
  fetchedAt(): string {
    return stampFetchedAt(this.clock);
  }

  /** Instruments are static intraday: fetch once per session, reuse afterwards. */
  catalog(underlying: string = "BTC"): Promise<InstrumentCatalog> {
    const key = underlying.toUpperCase();
    let promise = this.catalogs.get(key);
    if (!promise) {
      promise = InstrumentCatalog.load(this.client, underlying).catch((cause: unknown) => {
        this.catalogs.delete(key); // retry on the next call
        throw cause;
      });
      this.catalogs.set(key, promise);
    }
    return promise;
  }
}

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `RTFP error: ${message}` }], isError: true };
}

function toInstrumentJson(instrument: DecodedInstrument) {
  return { ...instrument };
}

export function buildServer(context: ServerContext): McpServer {
  const server = new McpServer(
    { name: "rtfp-mcp", version: "0.1.0" },
    { instructions: "Live GFO-X RTFP market data for BTC futures, options and strategies." },
  );

  const instrumentJson = z.enum(["all", "futures", "options", "strategies"]).default("all");

  server.registerTool(
    "get_instruments",
    {
      title: "List instruments",
      description:
        "Decoded instrument catalog (futures, options, strategies): symbols, gfo_id, " +
        "expiry, strike in USD, tick table. Static intraday; cached per session.",
      inputSchema: { underlying: z.string().default("BTC"), category: instrumentJson },
    },
    async ({ underlying, category }) => {
      try {
        const catalog = await context.catalog(underlying);
        const pick = (list: DecodedInstrument[]) => list.map(toInstrumentJson);
        const payload =
          category === "all"
            ? {
                futures: pick(catalog.futures),
                options: pick(catalog.options),
                strategies: pick(catalog.strategies),
                fetched_at: context.fetchedAt(),
              }
            : category === "futures"
              ? { futures: pick(catalog.futures), fetched_at: context.fetchedAt() }
              : category === "options"
                ? { options: pick(catalog.options), fetched_at: context.fetchedAt() }
                : { strategies: pick(catalog.strategies), fetched_at: context.fetchedAt() };
        return text(payload);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "find_instrument",
    {
      title: "Find one instrument",
      description:
        "Resolve a symbol, name prefix or gfo_id to its decoded instrument record. " +
        "Use this to map e.g. GFBTF260424 to its gfo_id before querying by instrument.",
      inputSchema: { query: z.string().describe("Symbol, name prefix or numeric gfo_id") },
    },
    async ({ query }) => {
      try {
        const catalog = await context.catalog();
        const instrument = catalog.find(query);
        if (!instrument) return text({ found: false, query });
        return text({ found: true, ...toInstrumentJson(instrument) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_recent_trades",
    {
      title: "Recent trades",
      description:
        "The last N executed trades (walks backward in 5-minute windows). " +
        "Prices are USD; timestamps are decoded to UTC ISO strings.",
      inputSchema: {
        n: z.number().int().positive().max(500).default(10),
        underlying: z.string().default("BTC"),
      },
    },
    async ({ n, underlying }) => {
      try {
        const catalog = await context.catalog(underlying);
        const trades = await recentTrades(context.client, catalog, n, {
          underlying,
          clock: context.clock,
        });
        return text({ count: trades.length, trades, fetched_at: context.fetchedAt() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_trades",
    {
      title: "Trades in a time range",
      description:
        "Executed trades between two times (max 24h per call; longer ranges must be " +
        "split). Times accept ISO-8601 or Unix seconds; bare ISO is London local. " +
        "Pass a symbol or instrument_id to narrow to one contract.",
      inputSchema: {
        start_time: timeValue,
        end_time: timeValue,
        underlying: z.string().default("BTC"),
        symbol: z.string().optional(),
        instrument_id: z.number().int().optional(),
      },
    },
    async ({ start_time, end_time, underlying, symbol, instrument_id }) => {
      const result = await queryRange(context, {
        kind: "trades",
        start: start_time,
        end: end_time,
        underlying,
        symbol,
        instrumentId: instrument_id,
      });
      if (!result.ok) return failure(new Error(result.error));
      return text({
        count: result.value.length,
        trades: result.value,
        fetched_at: result.fetchedAt,
      });
    },
  );

  server.registerTool(
    "get_current_quotes",
    {
      title: "Current bid/ask per futures contract",
      description:
        "Latest orderbook snapshot per futures contract: best bid, ask, mid and " +
        "expiry, ordered by expiry. Sparse contracts are widened to a 300s window " +
        "before being reported unquoted. This is the source of truth for 'current price'.",
      inputSchema: {
        underlying: z.string().default("BTC"),
        symbol: z.string().optional(),
      },
    },
    async ({ underlying, symbol }) => {
      try {
        const catalog = await context.catalog(underlying);
        const instrumentId = symbol ? catalog.find(symbol)?.gfoId : undefined;
        const quotes = await currentQuotes(context.client, catalog, {
          underlying,
          instrumentId,
          clock: context.clock,
        });
        return text({ quotes, fetched_at: context.fetchedAt() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_orderbook",
    {
      title: "Orderbook snapshots",
      description:
        "Decoded orderbook snapshots in a time range (max 24h; 300s windows are " +
        "chunked automatically). ISO timestamps and USD price levels.",
      inputSchema: {
        start_time: timeValue,
        end_time: timeValue,
        underlying: z.string().default("BTC"),
        symbol: z.string().optional(),
        instrument_id: z.number().int().optional(),
      },
    },
    async ({ start_time, end_time, underlying, symbol, instrument_id }) => {
      const result = await queryRange(context, {
        kind: "orderbook",
        start: start_time,
        end: end_time,
        underlying,
        symbol,
        instrumentId: instrument_id,
      });
      if (!result.ok) return failure(new Error(result.error));
      return text({
        count: result.value.length,
        snapshots: result.value,
        fetched_at: result.fetchedAt,
      });
    },
  );

  server.registerTool(
    "get_statistics",
    {
      title: "OHLC statistics",
      description:
        "Open/high/low/last price and volume per contract in a time range (max 24h). " +
        "last_price is the last *traded* price, not the current quote - use " +
        "get_current_quotes when you mean 'current'.",
      inputSchema: {
        start_time: timeValue,
        end_time: timeValue,
        underlying: z.string().default("BTC"),
        symbol: z.string().optional(),
        instrument_id: z.number().int().optional(),
      },
    },
    async ({ start_time, end_time, underlying, symbol, instrument_id }) => {
      const result = await queryRange(context, {
        kind: "statistics",
        start: start_time,
        end: end_time,
        underlying,
        symbol,
        instrumentId: instrument_id,
      });
      if (!result.ok) return failure(new Error(result.error));
      return text({
        count: result.value.length,
        statistics: result.value,
        fetched_at: result.fetchedAt,
      });
    },
  );

  server.registerTool(
    "get_fulltick",
    {
      title: "Full tick events",
      description:
        "Decoded order-flow events in a time range (max 24h): order added (A), " +
        "deleted (D), opening price (O), settlement (S), book state (T).",
      inputSchema: {
        start_time: timeValue,
        end_time: timeValue,
        underlying: z.string().default("BTC"),
        symbol: z.string().optional(),
        instrument_id: z.number().int().optional(),
      },
    },
    async ({ start_time, end_time, underlying, symbol, instrument_id }) => {
      const result = await queryRange(context, {
        kind: "fulltick",
        start: start_time,
        end: end_time,
        underlying,
        symbol,
        instrumentId: instrument_id,
      });
      if (!result.ok) return failure(new Error(result.error));
      return text({
        count: result.value.length,
        events: result.value,
        fetched_at: result.fetchedAt,
      });
    },
  );

  server.registerTool(
    "get_options_valuation",
    {
      title: "Options prices, IV and greeks",
      description:
        "Current valuations for every listed option, joined with the catalog: " +
        "symbol, strike USD, call/put, expiry, option price, implied volatility " +
        "(decimal - 0.91 = 91%), delta, gamma, vega. No time range: always live.",
      inputSchema: { underlying: z.string().default("BTC") },
    },
    async ({ underlying }) => {
      const result = await queryRange(context, { kind: "options_valuation", underlying });
      if (!result.ok) return failure(new Error(result.error));
      return text({
        count: result.value.length,
        valuations: result.value,
        fetched_at: result.fetchedAt,
      });
    },
  );

  const black76Base = {
    future_price: z.number().positive().describe("Futures price F (USD)"),
    strike: z.number().positive().describe("Strike K (USD)"),
    time_to_expiry_years: z.number().positive().describe("Time to expiry in years"),
    rate: z.number().describe("Risk-free rate, annualised (e.g. 0.053 for 5.3%)"),
    call_put: z.enum(["C", "P"]).describe("C = call, P = put"),
  };

  server.registerTool(
    "black76_price",
    {
      title: "Black76 option price",
      description:
        "Price a cash-settled futures option with Black76. The underlying is the " +
        "futures price F, not BTC spot.",
      inputSchema: {
        ...black76Base,
        volatility: z.number().positive().describe("Implied volatility, decimal (0.91 = 91%)"),
      },
    },
    async (input) => {
      const price = black76Price({
        futurePrice: input.future_price,
        strike: input.strike,
        timeToExpiryYears: input.time_to_expiry_years,
        rate: input.rate,
        volatility: input.volatility,
        callPut: input.call_put,
      });
      return text({ priceUsd: price, ...input });
    },
  );

  server.registerTool(
    "black76_implied_vol",
    {
      title: "Implied volatility (Black76)",
      description:
        "Solve for the Black76 implied volatility that matches a market price. " +
        "Returns null when the market price is outside the achievable price range.",
      inputSchema: {
        ...black76Base,
        market_price: z.number().positive().describe("Observed option price (USD)"),
      },
    },
    async (input) => {
      const vol = black76ImpliedVol({
        futurePrice: input.future_price,
        strike: input.strike,
        timeToExpiryYears: input.time_to_expiry_years,
        rate: input.rate,
        callPut: input.call_put,
        marketPrice: input.market_price,
      });
      return text({ impliedVolatility: vol, ...input });
    },
  );

  return server;
}
