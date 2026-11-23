/**
 * Decoding rules for RTFP wire formats.
 *
 * The GFO-X RTFP API mixes several encodings that trip up naive clients:
 *
 * - Most response `timestamp` fields (trades, orderbook, statistics, fulltick)
 *   and the `expiry`/`effective` fields in `instrument_dict` are *structured
 *   integers*: `unix_seconds * 1e9 + sub_second_sequence`. These exceed
 *   JavaScript's MAX_SAFE_INTEGER, so bigint inputs (or strings, which is how
 *   instrument_dict delivers them) are decoded exactly. Number inputs keep
 *   second-level exactness (float64 rounding error is ~256ns, far below 1s).
 * - `options_valuation.exchange_timestamp` is plain Unix seconds.
 * - `instrument_dict` static prices (`strike_price`, `tick_size`) are scaled
 *   integers that must be divided by `10 ** currency_multiplier`.
 * - Live endpoint prices (orderbook, statistics, trades, fulltick,
 *   options_valuation) are already plain USD floats and need no decoding.
 */

import { londonOffsetSeconds } from "./query-window.js";

export type StructuredTimestamp = number | bigint | string;

function asBigInt(ts: StructuredTimestamp): bigint {
  if (typeof ts === "number") {
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error(`non-positive structured timestamp: ${String(ts)}`);
    }
    return BigInt(Math.round(ts));
  }
  if (typeof ts === "bigint") {
    if (ts <= 0n) throw new Error(`non-positive structured timestamp: ${String(ts)}`);
    return ts;
  }
  const text = ts.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`malformed structured timestamp: ${text}`);
  }
  const value = BigInt(text);
  if (value <= 0n) throw new Error(`non-positive structured timestamp: ${text}`);
  return value;
}

/** Decode a structured timestamp (ns + sequence) to Unix seconds. */
export function structuredToUnixSeconds(ts: StructuredTimestamp): number {
  return Number(asBigInt(ts) / 10n ** 9n);
}

/** Millisecond sub-second remainder of a structured timestamp (0-999). */
export function structuredMillis(ts: StructuredTimestamp): number {
  return Number((asBigInt(ts) % 10n ** 9n) / 10n ** 6n);
}

/** ISO-8601 UTC string for a Unix-seconds value, e.g. 2026-04-16T09:14:22Z. */
export function unixSecondsToIso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace(".000Z", "Z");
}

/** Human-readable structured timestamp with UTC and London time. */
export function formatStructuredTs(ts: StructuredTimestamp): string {
  const unixSec = structuredToUnixSeconds(ts);
  const millis = structuredMillis(ts);
  const london = new Date((unixSec + londonOffsetSeconds(unixSec)) * 1000);
  const utc = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const utcText =
    `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ` +
    `${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
  const londonText =
    `${pad(london.getUTCHours())}:${pad(london.getUTCMinutes())}:${pad(london.getUTCSeconds())}`;
  return `${utcText}.${String(millis).padStart(3, "0")} UTC (${londonText} London)`;
}

/** Decode an instrument_dict static price field (strike, tick size) to USD. */
export function decodeScaledPrice(value: number | string, currencyMultiplier: number): number {
  return Number(value) / 10 ** currencyMultiplier;
}
