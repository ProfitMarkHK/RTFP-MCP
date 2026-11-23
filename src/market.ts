/**
 * Higher-level market-data workflows over the raw endpoints.
 *
 * - "Current price" comes from /orderbook: the latest snapshot per contract
 *   within the queried window (max timestamp), with automatic widening from
 *   a short window to 300s when a contract is sparse. It is never substituted
 *   with statistics.last_price.
 * - "Last traded price" comes from /trades or statistics.last_price and is
 *   reported only when explicitly requested.
 */

import { MAX_WINDOW_SECONDS, RtfpClient, type JsonRecord } from "./client.js";
import type { DecodedInstrument, InstrumentCatalog } from "./catalog.js";
import { structuredToUnixSeconds, unixSecondsToIso } from "./decode.js";

export interface Trade {
  timestampIso: string;
  timestampUnixSec: number;
  symbol: string;
  gfoId: number;
  tradeId: string;
  side: "B" | "S" | string;
  quantity: number;
  priceUsd: number;
}

export interface Quote {
  symbol: string;
  gfoId: number;
  expiryIso: string;
  bidUsd: number | null;
  askUsd: number | null;
  midUsd: number | null;
  snapshotIso: string;
}

export interface Statistics {
  symbol: string;
  gfoId: number;
  timestampIso: string;
  openUsd: number | null;
  highUsd: number | null;
  lowUsd: number | null;
  lastUsd: number | null;
  referenceUsd: number | null;
  totalVolume: number | null;
  openInterest: number | null;
}

export interface OptionValuation {
  symbol: string;
  gfoId: number;
  strikePriceUsd: number | null;
  callPut: "C" | "P" | null;
  expiryIso: string;
  exchangeTimestampIso: string;
  underlyingFuturePriceUsd: number | null;
  optionPriceUsd: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ISO UTC string from a structured (ns) timestamp field, or "". */
function isoFromStructured(value: unknown): string {
  const ts = num(value);
  return ts === null ? "" : unixSecondsToIso(structuredToUnixSeconds(ts));
}

/** ISO UTC string from a plain Unix-seconds field, or "". */
function isoFromUnixSeconds(value: unknown): string {
  const ts = num(value);
  return ts === null ? "" : unixSecondsToIso(ts);
}

/** Catalog lookup by a record's contract_number. */
function instrumentFor(record: JsonRecord, catalog: InstrumentCatalog): DecodedInstrument | null {
  const gfoId = num(record.contract_number);
  return gfoId === null ? null : catalog.find(gfoId);
}

function greeks(
  record: JsonRecord,
): { delta: number | null; gamma: number | null; vega: number | null } {
  const raw = record.option_greeks;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { delta: null, gamma: null, vega: null };
  }
  const g = raw as JsonRecord;
  return { delta: num(g.delta), gamma: num(g.gamma), vega: num(g.vega) };
}

export function toTrades(records: JsonRecord[], catalog: InstrumentCatalog): Trade[] {
  return records.map((r) => {
    const gfoId = num(r.contract_number);
    const instrument = instrumentFor(r, catalog);
    const ts = num(r.timestamp);
    return {
      timestampIso: isoFromStructured(r.timestamp),
      timestampUnixSec: ts === null ? 0 : structuredToUnixSeconds(ts),
      symbol: instrument?.symbol ?? (gfoId === null ? "" : String(gfoId)),
      gfoId: gfoId ?? -1,
      tradeId: String(r.trade_id ?? ""),
      side: typeof r.aggressor_side === "string" ? r.aggressor_side : "",
      quantity: num(r.quantity_executed) ?? 0,
      priceUsd: num(r.trade_price) ?? 0,
    };
  });
}

export function toStatistics(records: JsonRecord[], catalog: InstrumentCatalog): Statistics[] {
  return records.map((r) => {
    const gfoId = num(r.contract_number);
    const instrument = instrumentFor(r, catalog);
    return {
      symbol: instrument?.symbol ?? (gfoId === null ? "" : String(gfoId)),
      gfoId: gfoId ?? -1,
      timestampIso: isoFromStructured(r.timestamp),
      openUsd: num(r.open_price),
      highUsd: num(r.high_price),
      lowUsd: num(r.low_price),
      lastUsd: num(r.last_price),
      referenceUsd: num(r.reference_price),
      totalVolume: num(r.total_volume),
      openInterest: num(r.open_interest),
    };
  });
}

/** Instrument-derived fields, nulled when the catalog cannot resolve the id. */
function instrumentFields(instrument: DecodedInstrument | null) {
  return {
    strikePriceUsd: instrument?.strikePriceUsd ?? null,
    callPut: instrument?.callPut ?? null,
    expiryIso: instrument?.expiryIso ?? "",
  };
}

/** Symbol/strike/expiry fields shared with the instrument catalog record. */
function valuationIdentity(instrument: DecodedInstrument | null, gfoId: number | null) {
  return {
    symbol: instrument?.symbol ?? String(gfoId ?? "?"),
    gfoId: gfoId ?? -1,
    ...instrumentFields(instrument),
  };
}

function toOptionValuation(r: JsonRecord, catalog: InstrumentCatalog): OptionValuation {
  const gfoId = num(r.contract_number);
  const instrument = gfoId === null ? null : catalog.find(gfoId);
  const { delta, gamma, vega } = greeks(r);
  return {
    ...valuationIdentity(instrument, gfoId),
    // options_valuation timestamps are plain Unix seconds (not structured).
    exchangeTimestampIso: isoFromUnixSeconds(r.exchange_timestamp),
    underlyingFuturePriceUsd: num(r.underlying_future_price),
    optionPriceUsd: num(r.option_price),
    impliedVolatility: num(r.option_implied_volatility),
    delta,
    gamma,
    vega,
  };
}

export function toOptionValuations(
  records: JsonRecord[],
  catalog: InstrumentCatalog,
): OptionValuation[] {
  return records.map((r) => toOptionValuation(r, catalog));
}

/** Latest orderbook snapshot per contract in the records (max structured ts). */
export function latestSnapshots(records: JsonRecord[]): Map<number, JsonRecord> {
  const latest = new Map<number, { ts: number; record: JsonRecord }>();
  for (const record of records) {
    const gfoId = num(record.contract_number);
    const ts = num(record.timestamp);
    if (gfoId === null || ts === null) continue;
    const current = latest.get(gfoId);
    if (!current || ts > current.ts) latest.set(gfoId, { ts, record });
  }
  return new Map([...latest].map(([id, v]) => [id, v.record]));
}

function topOfBook(record: JsonRecord): { bid: number | null; ask: number | null } {
  const bids = Array.isArray(record.bids) ? (record.bids as JsonRecord[]) : [];
  const asks = Array.isArray(record.asks) ? (record.asks as JsonRecord[]) : [];
  return { bid: num(bids[0]?.price), ask: num(asks[0]?.price) };
}

function midOf(bid: number | null, ask: number | null): number | null {
  return bid !== null && ask !== null ? (bid + ask) / 2 : null;
}

function snapshotToQuote(record: JsonRecord, catalog: InstrumentCatalog): Quote {
  const gfoId = num(record.contract_number);
  const instrument = gfoId === null ? null : catalog.find(gfoId);
  const { bid, ask } = topOfBook(record);
  return {
    symbol: instrument?.symbol ?? String(gfoId ?? "?"),
    gfoId: gfoId ?? -1,
    expiryIso: instrument?.expiryIso ?? "",
    bidUsd: bid,
    askUsd: ask,
    midUsd: midOf(bid, ask),
    snapshotIso: isoFromStructured(record.timestamp),
  };
}

/** Futures the quotes table should cover: the whole strip, or one contract. */
function targetFutures(catalog: InstrumentCatalog, instrumentId?: number): DecodedInstrument[] {
  if (instrumentId === undefined) return catalog.futures;
  return catalog.futures.filter((f) => f.gfoId === instrumentId);
}

/** Contract ids that have any bid or ask in their latest snapshot. */
function quotedContractIds(snapshots: Map<number, JsonRecord>): Set<number> {
  const ids = new Set<number>();
  for (const [id, record] of snapshots) {
    const { bid, ask } = topOfBook(record);
    if (bid !== null || ask !== null) ids.add(id);
  }
  return ids;
}

/** Replace (only if newer) the snapshot of every missing contract. */
async function widenForMissing(
  client: RtfpClient,
  snapshots: Map<number, JsonRecord>,
  missing: number[],
  underlying: string,
): Promise<void> {
  if (missing.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const wide = await client.getPage("orderbook", {
    underlying,
    start_time: now - MAX_WINDOW_SECONDS,
    end_time: now,
  });
  for (const record of wide) {
    const gfoId = num(record.contract_number);
    if (gfoId === null || !missing.includes(gfoId)) continue;
    const current = snapshots.get(gfoId);
    if (!current || (num(current.timestamp) ?? 0) < (num(record.timestamp) ?? 0)) {
      snapshots.set(gfoId, record);
    }
  }
}

/**
 * Current bid/ask per futures contract: short window first, widen to 300s
 * for contracts that returned nothing. A sparse orderbook is not "no quote".
 */
export async function currentQuotes(
  client: RtfpClient,
  catalog: InstrumentCatalog,
  options: { underlying?: string; instrumentId?: number } = {},
): Promise<Quote[]> {
  const underlying = options.underlying ?? "BTC";
  const now = Math.floor(Date.now() / 1000);
  const shortParams: Record<string, string | number> = {
    underlying,
    start_time: now - 5,
    end_time: now,
  };
  if (options.instrumentId !== undefined) shortParams.instrument_id = options.instrumentId;
  const snapshots = latestSnapshots(await client.getPage("orderbook", shortParams));

  const targetIds = new Set(targetFutures(catalog, options.instrumentId).map((f) => f.gfoId));
  const quoted = quotedContractIds(snapshots);
  const missing = [...targetIds].filter((id) => !quoted.has(id));
  await widenForMissing(client, snapshots, missing, underlying);

  return [...snapshots]
    .filter(([id]) => targetIds.has(id))
    .map(([, record]) => snapshotToQuote(record, catalog))
    .sort((a, b) => a.expiryIso.localeCompare(b.expiryIso));
}

/** Walk backward in 5-minute windows until `n` unique trades are collected. */
export async function recentTrades(
  client: RtfpClient,
  catalog: InstrumentCatalog,
  n: number,
  options: { underlying?: string; maxWindows?: number } = {},
): Promise<Trade[]> {
  const underlying = options.underlying ?? "BTC";
  const maxWindows = options.maxWindows ?? 288; // 24h of 5-minute windows.
  const now = Math.floor(Date.now() / 1000);
  const collected = new Map<string, Trade>();
  for (let i = 0; i < maxWindows && collected.size < n; i++) {
    const end = now - i * MAX_WINDOW_SECONDS;
    const records = await client.getPage("trades", {
      underlying,
      start_time: end - MAX_WINDOW_SECONDS,
      end_time: end,
    });
    for (const trade of toTrades(records, catalog)) {
      if (!collected.has(trade.tradeId)) collected.set(trade.tradeId, trade);
    }
  }
  return [...collected.values()]
    .sort((a, b) => b.timestampUnixSec - a.timestampUnixSec)
    .slice(0, n);
}
