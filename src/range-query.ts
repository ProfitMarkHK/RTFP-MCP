/**
 * The single seam for every tool that asks the venue about a slice of market
 * data (plus the live options valuation, which has no time range).
 *
 * Callers hand over a discriminated request and a small dependency object;
 * everything else — range validation, catalog load, symbol resolution,
 * fetching, decoding and freshness stamping — stays behind this boundary.
 * Failures come back tagged, never thrown, so the MCP shell can map them to
 * its existing text/error responses.
 */

import type { InstrumentCatalog } from "./catalog.js";
import type { RtfpClient } from "./client.js";
import {
  type OptionValuation,
  type OrderbookSnapshot,
  type OrderFlowEvent,
  type Statistics,
  type Trade,
  toOptionValuations,
  toOrderbookSnapshots,
  toOrderFlowEvents,
  toStatistics,
  toTrades,
} from "./market.js";
import {
  type Clock,
  exceedsMaxRange,
  INVERTED_RANGE_MESSAGE,
  isInvertedRange,
  parseTimeParam,
  rangeTooLargeMessage,
} from "./query-window.js";

/** The shell owns the client, the clock and the session-cached catalog. */
export interface RangeQueryDeps {
  client: RtfpClient;
  clock: Clock;
  catalog(underlying?: string): Promise<InstrumentCatalog>;
}

export interface RangeQueryFilter {
  underlying: string;
  symbol?: string;
  instrumentId?: number;
}

type TimedRequest = RangeQueryFilter & { start: string | number; end: string | number };

export type RangeQueryRequest =
  | ({ kind: "trades" } & TimedRequest)
  | ({ kind: "orderbook" } & TimedRequest)
  | ({ kind: "statistics" } & TimedRequest)
  | ({ kind: "fulltick" } & TimedRequest)
  | ({ kind: "options_valuation" } & RangeQueryFilter);

export interface RangeQueryValues {
  trades: Trade[];
  orderbook: OrderbookSnapshot[];
  statistics: Statistics[];
  fulltick: OrderFlowEvent[];
  options_valuation: OptionValuation[];
}

export type RangeQueryResult<V> =
  | { ok: true; value: V; fetchedAt: string }
  | { ok: false; error: string };

/** Freshness stamp from the injected clock, shared with the shell. */
export function stampFetchedAt(clock: Clock): string {
  return new Date(Math.round(clock() * 1000)).toISOString().replace(".000Z", "Z");
}

/** The one entry point: request in, tagged decoded result out. */
export async function queryRange<K extends keyof RangeQueryValues>(
  deps: RangeQueryDeps,
  request: Extract<RangeQueryRequest, { kind: K }>,
): Promise<RangeQueryResult<RangeQueryValues[K]>> {
  try {
    const value = await runQuery(deps, request);
    return { ok: true, value: value as RangeQueryValues[K], fetchedAt: stampFetchedAt(deps.clock) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runQuery(
  deps: RangeQueryDeps,
  request: RangeQueryRequest,
): Promise<RangeQueryValues[keyof RangeQueryValues]> {
  if (request.kind === "options_valuation") {
    const catalog = await deps.catalog(request.underlying);
    const records = await deps.client.getPage("options_valuation", {
      underlying: request.underlying,
    });
    return toOptionValuations(records, catalog);
  }

  const { startTime, endTime } = validatedRange(request);
  const catalog = await deps.catalog(request.underlying);
  const params = instrumentParams(catalog, request);
  const records = await deps.client.fetchRange(request.kind, startTime, endTime, params);
  switch (request.kind) {
    case "trades":
      return toTrades(records, catalog).sort((a, b) => a.timestampUnixSec - b.timestampUnixSec);
    case "orderbook":
      return toOrderbookSnapshots(records, catalog);
    case "statistics":
      return toStatistics(records, catalog);
    case "fulltick":
      return toOrderFlowEvents(records, catalog);
  }
}

function validatedRange(request: TimedRequest): { startTime: number; endTime: number } {
  const startTime = parseTimeParam(request.start);
  const endTime = parseTimeParam(request.end);
  if (isInvertedRange(startTime, endTime)) throw new Error(INVERTED_RANGE_MESSAGE);
  if (exceedsMaxRange(startTime, endTime)) throw new Error(rangeTooLargeMessage());
  return { startTime, endTime };
}

function instrumentParams(
  catalog: InstrumentCatalog,
  options: RangeQueryFilter,
): Record<string, string | number> {
  const params: Record<string, string | number> = { underlying: options.underlying };
  if (options.instrumentId !== undefined) {
    params.instrument_id = options.instrumentId;
    return params;
  }
  if (options.symbol) {
    const instrument = catalog.find(options.symbol);
    if (!instrument) throw new Error(`unknown instrument: ${options.symbol}`);
    params.instrument_id = instrument.gfoId;
  }
  return params;
}
