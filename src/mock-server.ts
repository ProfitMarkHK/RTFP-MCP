/**
 * RTFP look-alike server.
 *
 * The GFO-X venue is not always reachable (VPN/office network, venue
 * downtime). This module serves a faithful RTFP look-alike over real HTTP so
 * the client, the MCP server and the live test suite can be exercised
 * anywhere:
 *
 *   bun run mock                        # serve on http://127.0.0.1:38973
 *   MOCK_PORT=39999 bun run mock         # custom port
 *   RTFP_LIVE=1 RTFP_BASE_URL=http://127.0.0.1:38973 bun test tests/live.test.ts
 *
 * Fidelity notes (deliberate reproductions of the documented API behaviour,
 * see docs/spec and the client's workarounds):
 * - Time-range endpoints enforce end > start and a <=300s window (400 else).
 * - The `next` URL points at a DIFFERENT host than the request was sent to,
 *   and stays non-empty after the final page. Correct clients re-issue against
 *   the original base URL and stop on an empty result.
 * - Response timestamps are structured numbers (unix_sec * 1e9 + sequence).
 * - instrument_dict prices are scaled by 10 ** currency_multiplier and its
 *   expiry/effective are exact structured-timestamp *strings*; live endpoint
 *   prices are plain USD floats.
 * - options_valuation uses plain Unix seconds and no time range.
 *
 * The market data itself is deterministic: a seeded PRNG keyed by
 * (instrument, second) reconstructs any window without stored state.
 */

import { black76Price } from "./black76.js";
import { realClock } from "./clock.js";
import {
  type Clock,
  INVERTED_RANGE_MESSAGE,
  isInvertedRange,
  MAX_WINDOW_SECONDS,
} from "./query-window.js";

export const MOCK_BASE_PRICE = 74_260;
export const MOCK_RISK_FREE_RATE = 0.05;
export const MOCK_DEFAULT_PORT = 38973;

const SECONDS_PER_DAY = 86_400;
const PAGE_LIMIT = 500;
const SNAPSHOT_INTERVAL = 10;
const STATS_INTERVAL = 30;
/** Deliberately wrong host for `next` URLs (bug fidelity). */
const WRONG_NEXT_HOST = "lookalike-rtfp.gfo.invalid";

type JsonRecord = Record<string, unknown>;

/** Fixture clock for this look-alike process; injectable via startMockServer. */
let fixtureClock: Clock = realClock;

// ---------- deterministic noise ----------

/** Small fast seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function (): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of integer parts, used to seed per-second randomness. */
function hashOf(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------- catalog ----------

interface FutureDef {
  gfoId: number;
  symbol: string;
  name: string;
  expirySec: number;
  monthsOut: number;
}

interface OptionDef {
  gfoId: number;
  symbol: string;
  name: string;
  futureId: number;
  strikeUsd: number;
  callPut: "C" | "P";
  expirySec: number;
}

function dayAt16Utc(daysFromNow: number): number {
  const now = Math.floor(fixtureClock());
  const midnight = now - (now % SECONDS_PER_DAY);
  return midnight + daysFromNow * SECONDS_PER_DAY + 16 * 3600;
}

function symbolStamp(expirySec: number): string {
  const d = new Date(expirySec * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Exact structured-timestamp string, as the real instrument_dict sends. */
function structuredString(unixSec: number): string {
  return String(BigInt(unixSec) * 10n ** 9n);
}

let cachedFutures: FutureDef[] | null = null;

/** The futures strip: 1, 2, 3 and 6 months out (fixed per server process). */
export function futuresDefs(): FutureDef[] {
  if (cachedFutures) return cachedFutures;
  const dayOffsets = [30, 61, 92, 184];
  cachedFutures = dayOffsets.map((days, i) => {
    const expirySec = dayAt16Utc(days);
    const stamp = symbolStamp(expirySec);
    return {
      gfoId: 9001 + i,
      symbol: `GFBTF${stamp}`,
      name: `BTCF-${stamp}`,
      expirySec,
      monthsOut: days / 30.4,
    };
  });
  return cachedFutures;
}

function futureById(gfoId: number): FutureDef {
  return futuresDefs().find((f) => f.gfoId === gfoId) ?? futuresDefs()[0]!;
}

let cachedOptions: OptionDef[] | null = null;

/** Options on the front two futures: 5 strikes x calls and puts. */
export function optionsDefs(): OptionDef[] {
  if (cachedOptions) return cachedOptions;
  const moneyness = [0.9, 0.95, 1.0, 1.05, 1.1];
  const front = futuresDefs().slice(0, 2);
  const defs: OptionDef[] = [];
  let id = 9100;
  for (const future of front) {
    for (const m of moneyness) {
      const strike = Math.round((MOCK_BASE_PRICE * m) / 100) * 100;
      const stamp = symbolStamp(future.expirySec);
      for (const callPut of ["C", "P"] as const) {
        defs.push({
          gfoId: id++,
          symbol: `GFBTO${stamp}${strike.toFixed(2)}${callPut}`,
          name: `BTC${callPut}-${stamp}-${strike}`,
          futureId: future.gfoId,
          strikeUsd: strike,
          callPut,
          expirySec: future.expirySec,
        });
      }
    }
  }
  cachedOptions = defs;
  return defs;
}

// ---------- market model ----------

/** Deterministic mid price for a future at a given second. */
function futureMid(def: FutureDef, sec: number): number {
  const hours = sec / 3600;
  const carry = 1 + 0.004 * def.monthsOut; // ~5% p.a. contango
  const wave =
    0.003 * Math.sin(hours / 9) +
    0.0015 * Math.sin(hours / 1.7 + def.gfoId) +
    0.0008 * Math.sin(hours * 7 + def.gfoId * 3);
  const drift = (mulberry32(hashOf(def.gfoId, Math.floor(sec / 60)))() - 0.5) * 60;
  return round2(MOCK_BASE_PRICE * carry * (1 + wave) + drift);
}

// ---------- per-endpoint window builders ----------

function tradeRecord(sec: number, seq: number, future: FutureDef): JsonRecord {
  const draw = mulberry32(hashOf(future.gfoId, sec, seq));
  const side = draw() < 0.5 ? "B" : "S";
  const price = round2(futureMid(future, sec) + (draw() < 0.5 ? -2.5 : 2.5));
  return {
    timestamp: sec * 1e9 + seq,
    contract_number: future.gfoId,
    trade_id: `T-${sec}-${seq}`,
    aggressor_order_id: "A-1",
    passive_order_id: "P-1",
    aggressor_side: side,
    quantity_executed: 1 + Math.floor(draw() * 5),
    trade_price: price,
    trading_session: "C",
    trade_type: "N",
    leg_count: 1,
    sub_trade_id: 1,
  };
}

/** Which future traded this second (front month dominates). */
function pickTradeFuture(sec: number): FutureDef {
  const defs = futuresDefs();
  const r = mulberry32(hashOf(77, sec))();
  if (r < 0.7) return defs[0]!;
  if (r < 0.85) return defs[1]!;
  if (r < 0.95) return defs[2]!;
  return defs[3]!;
}

function pushTradesForSecond(out: JsonRecord[], sec: number, fid: number | null): void {
  const u = mulberry32(hashOf(4242, sec))();
  if (u >= 0.3) return;
  const future = pickTradeFuture(sec);
  if (fid === null || future.gfoId === fid) out.push(tradeRecord(sec, 0, future));
  if (u >= 0.05) return; // occasional second fill in the same second
  if (fid === null || future.gfoId === fid) out.push(tradeRecord(sec, 1, future));
}

function buildTrades(start: number, end: number, fid: number | null): JsonRecord[] {
  const out: JsonRecord[] = [];
  for (let sec = start; sec < end; sec++) pushTradesForSecond(out, sec, fid);
  return out;
}

function bookLevels(mid: number, count: number, isBid: boolean): JsonRecord[] {
  const step = isBid ? -2.5 : 2.5;
  return Array.from({ length: count }, (_, i) => ({
    quantity: 1 + ((hashOf(Math.round(mid), i, isBid ? 1 : 0) % 10) | 0),
    price: round2(mid + step * (i + 1)),
  }));
}

function orderbookSnapshot(sec: number, future: FutureDef): JsonRecord {
  const mid = futureMid(future, sec);
  const bids = bookLevels(mid, 3, true);
  const asks = bookLevels(mid, 3, false);
  return {
    timestamp: sec * 1e9,
    contract_number: future.gfoId,
    state: "O",
    num_of_bids: bids.length,
    num_of_asks: asks.length,
    bids,
    asks,
    full_tick_reference_sequence: sec,
  };
}

function buildOrderbook(start: number, end: number, fid: number | null): JsonRecord[] {
  const out: JsonRecord[] = [];
  const first = Math.ceil(start / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
  for (let sec = first; sec < end; sec += SNAPSHOT_INTERVAL) {
    for (const future of futuresDefs()) {
      if (fid === null || future.gfoId === fid) out.push(orderbookSnapshot(sec, future));
    }
  }
  return out;
}

/** Highest and lowest sampled mid over (from, to]. */
function highLow(future: FutureDef, from: number, to: number): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (let sec = from; sec < to; sec += 5) {
    const mid = futureMid(future, sec);
    high = Math.max(high, mid);
    low = Math.min(low, mid);
  }
  return { high: round2(high), low: round2(low) };
}

function statsRecord(sec: number, future: FutureDef): JsonRecord {
  const from = sec - STATS_INTERVAL;
  const { high, low } = highLow(future, from, sec);
  const volumeSeed = hashOf(future.gfoId, Math.floor(sec / 60));
  return {
    timestamp: sec * 1e9,
    contract_number: future.gfoId,
    open_price: futureMid(future, from),
    high_price: high,
    low_price: low,
    last_price: futureMid(future, sec - 1),
    reference_price: futureMid(future, sec),
    last_volume: 1 + (volumeSeed % 5),
    total_volume: 40 + (volumeSeed % 300),
    total_number_of_trades: 5 + (volumeSeed % 60),
    open_interest: 1000 + (volumeSeed % 5000),
  };
}

function buildStatistics(start: number, end: number, fid: number | null): JsonRecord[] {
  const out: JsonRecord[] = [];
  const first = Math.ceil(start / STATS_INTERVAL) * STATS_INTERVAL;
  for (let sec = first; sec < end; sec += STATS_INTERVAL) {
    for (const future of futuresDefs()) {
      if (fid === null || future.gfoId === fid) out.push(statsRecord(sec, future));
    }
  }
  return out;
}

function tickEvent(sec: number, seq: number, kind: "A" | "D" | "S" | "T"): JsonRecord {
  const future = futuresDefs()[0]!;
  const draw = mulberry32(hashOf(9, sec, seq));
  const base: JsonRecord = {
    timestamp: sec * 1e9 + seq,
    contract_number: future.gfoId,
    message_type: kind,
  };
  if (kind === "A") {
    base.order_id = `O-${sec}-${seq}`;
    base.volume = 1 + Math.floor(draw() * 10);
    base.price = round2(futureMid(future, sec) + (draw() < 0.5 ? -10 : 10));
    base.side = draw() < 0.5 ? "B" : "S";
    base.type = "D";
  } else if (kind === "D") {
    base.order_id = `O-${sec}-x`;
    base.side = draw() < 0.5 ? "B" : "S";
    base.remaining = Math.floor(draw() * 5);
  } else if (kind === "S") {
    base.price = futureMid(future, sec);
  } else {
    base.state = "O";
  }
  return base;
}

function pushTickSecond(out: JsonRecord[], sec: number): void {
  // 2+ events/second guarantees a 300s window exceeds the 500-row page and
  // exercises multi-page pagination over the never-empty `next` bug.
  out.push(tickEvent(sec, 0, "A"), tickEvent(sec, 1, "A"));
  const u = mulberry32(hashOf(9, sec))();
  if (u < 0.1) out.push(tickEvent(sec, 2, "D"));
  if (sec % 45 === 0) out.push(tickEvent(sec, 3, "S"));
  if (sec % 90 === 0) out.push(tickEvent(sec, 4, "T"));
}

function buildFulltick(start: number, end: number): JsonRecord[] {
  const out: JsonRecord[] = [];
  for (let sec = start; sec < end; sec++) pushTickSecond(out, sec);
  return out;
}

// ---------- options_valuation (live, no time range) ----------

function priceOf(option: OptionDef, F: number, years: number, vol: number): number {
  return black76Price({
    futurePrice: F,
    strike: option.strikeUsd,
    timeToExpiryYears: years,
    rate: MOCK_RISK_FREE_RATE,
    volatility: vol,
    callPut: option.callPut,
  });
}

/** Smile-shaped IV: flat ~63% ATM, rising with moneyness. */
function smileVol(option: OptionDef, F: number): number {
  const moneyness = option.strikeUsd / F - 1;
  return round2(0.63 + 2.2 * moneyness * moneyness + 0.1 * Math.abs(moneyness));
}

function yearsToExpiry(expirySec: number, now: number): number {
  return Math.max((expirySec - now) / (365.25 * SECONDS_PER_DAY), 1 / 365);
}

function greeksOf(option: OptionDef, F: number, years: number, vol: number): JsonRecord {
  const up = priceOf(option, F + 1, years, vol);
  const down = priceOf(option, F - 1, years, vol);
  const at = priceOf(option, F, years, vol);
  const volUp = priceOf(option, F, years, vol + 0.01);
  const volDown = priceOf(option, F, years, vol - 0.01);
  return {
    delta: round2((up - down) / 2),
    gamma: round2(up - 2 * at + down),
    vega: round2((volUp - volDown) / 2),
  };
}

export function optionValuationRecords(): JsonRecord[] {
  const now = Math.floor(fixtureClock());
  return optionsDefs().map((option): JsonRecord => {
    const F = futureMid(futureById(option.futureId), now);
    const years = yearsToExpiry(option.expirySec, now);
    const vol = smileVol(option, F);
    return {
      exchange_timestamp: now, // plain Unix seconds, per the real endpoint
      contract_number: option.gfoId,
      underlying_future_price: F,
      option_price: round2(priceOf(option, F, years, vol)),
      option_implied_volatility: vol,
      option_greeks: greeksOf(option, F, years, vol),
    };
  });
}

// ---------- instrument_dict ----------

function tickTableRaw(tickSizeUsd: number): JsonRecord[] {
  return [{ tick_size: tickSizeUsd * 10 ** 10, upper_limit: 0 }];
}

function futureRecord(def: FutureDef): JsonRecord {
  return {
    type: "F",
    name: def.name,
    gfo_id: def.gfoId,
    parent_id: 0,
    symbol: def.symbol,
    isin: "",
    settlement_type: "C",
    trade_currency: "USD",
    currency_multiplier: 10,
    tick_table: tickTableRaw(5),
    expiry: structuredString(def.expirySec),
    effective: structuredString(def.expirySec - 90 * SECONDS_PER_DAY),
    size_multiplier: 1,
    contract_multiplier: 1,
    cfi_code: "FFCCPS",
  };
}

function optionRecord(def: OptionDef): JsonRecord {
  return {
    ...futureRecord({ ...futureById(def.futureId), gfoId: def.gfoId, symbol: def.symbol, name: def.name }),
    type: "O",
    strike_price: def.strikeUsd * 10 ** 10,
    exercise_type: "E",
    call_put: def.callPut,
  };
}

function strategyRecord(): JsonRecord {
  const defs = futuresDefs();
  const front = defs[0]!;
  const back = defs[1]!;
  const stampA = symbolStamp(front.expirySec);
  const stampB = symbolStamp(back.expirySec);
  return {
    type: "S",
    name: `BTCCAL-${stampA}-${stampB}`,
    gfo_id: 9501,
    parent_id: 0,
    symbol: `GFBTFS${stampA}-${stampB}`,
    isin: "",
    settlement_type: "C",
    trade_currency: "USD",
    currency_multiplier: 10,
    expiry: structuredString(front.expirySec),
    strategy: [
      { leg_instrument_id: front.gfoId, leg_volume: 1 },
      { leg_instrument_id: back.gfoId, leg_volume: -1 },
    ],
  };
}

export function instrumentDict(): { result: { futures: unknown[]; options: unknown[]; strategies: unknown[] } } {
  return {
    result: {
      futures: futuresDefs().map(futureRecord),
      options: optionsDefs().map(optionRecord),
      strategies: [strategyRecord()],
    },
  };
}

// ---------- HTTP layer ----------

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function intParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function windowRecords(endpoint: string, start: number, end: number, fid: number | null): JsonRecord[] {
  switch (endpoint) {
    case "trades":
      return buildTrades(start, end, fid);
    case "orderbook":
      return buildOrderbook(start, end, fid);
    case "statistics":
      return buildStatistics(start, end, fid);
    default:
      return buildFulltick(start, end);
  }
}

function handleTimeRange(endpoint: string, params: URLSearchParams): Response {
  const start = intParam(params, "start_time");
  const end = intParam(params, "end_time");
  if (start === null || end === null) return json({ error: "start_time and end_time required" }, 400);
  if (isInvertedRange(start, end)) return json({ error: INVERTED_RANGE_MESSAGE }, 400);
  if (end - start > MAX_WINDOW_SECONDS) {
    return json({ error: `window exceeds ${MAX_WINDOW_SECONDS} seconds` }, 400);
  }
  const fid = intParam(params, "instrument_id");
  const offset = intParam(params, "start") ?? 0;
  const all = windowRecords(endpoint, start, end, fid);
  const page = all.slice(offset, offset + PAGE_LIMIT);
  return json({ result: page, limit: PAGE_LIMIT, next: wrongHostNext(endpoint, params, offset + page.length) });
}

/**
 * Faithful to both documented bugs: the host is wrong and the URL is never
 * empty, even after the final page.
 */
function wrongHostNext(endpoint: string, params: URLSearchParams, offset: number): string {
  const qs = new URLSearchParams();
  for (const [key, value] of params) {
    if (key !== "start") qs.set(key, value);
  }
  qs.set("start", String(offset));
  return `https://${WRONG_NEXT_HOST}:38973/${endpoint}?${qs.toString()}`;
}

function handleRequest(request: Request): Response {
  const url = new URL(request.url);
  const endpoint = url.pathname.replace(/^\/+/, "");
  switch (endpoint) {
    case "":
      return json({ name: "rtfp look-alike", status: "ok", note: "mock market data" });
    case "instrument_dict":
      return json(instrumentDict());
    case "options_valuation": {
      const offset = intParam(url.searchParams, "start") ?? 0;
      const all = optionValuationRecords();
      const page = all.slice(offset, offset + PAGE_LIMIT);
      return json({
        result: page,
        limit: PAGE_LIMIT,
        next: wrongHostNext(endpoint, url.searchParams, offset + page.length),
      });
    }
    case "trades":
    case "orderbook":
    case "statistics":
    case "fulltick":
      return handleTimeRange(endpoint, url.searchParams);
    default:
      return json({ error: `unknown endpoint: ${endpoint}` }, 404);
  }
}

export interface MockServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** Start the look-alike. Port 0 lets the OS pick a free port. */
export function startMockServer(
  options: { port?: number; hostname?: string; clock?: Clock } = {},
): MockServer {
  const previousClock = fixtureClock;
  fixtureClock = options.clock ?? realClock;
  cachedFutures = null;
  cachedOptions = null;
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    fetch: handleRequest,
  });
  return {
    url: `http://${server.hostname}:${server.port}`,
    port: server.port ?? 0,
    stop: async () => {
      server.stop(true);
      fixtureClock = previousClock;
      cachedFutures = null;
      cachedOptions = null;
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.MOCK_PORT ?? MOCK_DEFAULT_PORT);
  const server = startMockServer({ port });
  console.log(
    `rtfp look-alike serving on ${server.url} (deterministic mock data; ` +
      `reproduces the API's known quirks; point clients at it with ` +
      `RTFP_BASE_URL=${server.url})`,
  );
}
