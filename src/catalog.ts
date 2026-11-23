/**
 * Decoded instrument catalog over `instrument_dict`.
 *
 * Instruments do not change intraday, so the catalog is fetched once per
 * server session and reused. All prices leaving this module are plain USD:
 * `strike_price` and `tick_size` arrive scaled by `10 ** currency_multiplier`
 * and are decoded here; expiry/effective structured timestamps become ISO
 * date strings.
 */

import type { JsonRecord, RtfpClient } from "./client.js";
import { decodeScaledPrice, structuredToUnixSeconds, unixSecondsToIso } from "./decode.js";

export interface DecodedInstrument {
  gfoId: number;
  symbol: string;
  name: string;
  type: "F" | "O" | "S";
  expiryIso: string;
  effectiveIso: string;
  /** Strike price in USD (options only). */
  strikePriceUsd: number | null;
  callPut: "C" | "P" | null;
  /** Tick rows in USD, highest-threshold last (options/futures only). */
  tickTableUsd: { tickSizeUsd: number; upperLimitUsd: number | null }[];
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function decodeTickTable(raw: unknown, multiplier: number): DecodedInstrument["tickTableUsd"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row): { tickSizeUsd: number; upperLimitUsd: number | null } | null => {
      if (row === null || typeof row !== "object") return null;
      const tick = asNumber((row as JsonRecord).tick_size);
      const limit = asNumber((row as JsonRecord).upper_limit);
      if (tick === null) return null;
      const decoded = decodeScaledPrice(tick, multiplier);
      // upper_limit 0 means "no upper limit": applies above all thresholds.
      return {
        tickSizeUsd: decoded,
        upperLimitUsd: limit === 0 ? null : limit === null ? 0 : limit,
      };
    })
    .filter((row): row is { tickSizeUsd: number; upperLimitUsd: number | null } => row !== null);
}

/** ISO date string from a structured timestamp field, or "" when absent. */
function isoFromStructured(value: unknown): string {
  const seconds = asNumber(value);
  return seconds === null ? "" : unixSecondsToIso(structuredToUnixSeconds(seconds));
}

function symbolOf(raw: JsonRecord, gfoId: number): string {
  if (typeof raw.symbol === "string") return raw.symbol;
  return typeof raw.name === "string" ? raw.name : String(gfoId);
}

function callPutOf(raw: JsonRecord): "C" | "P" | null {
  const value = raw.call_put;
  return value === "C" || value === "P" ? value : null;
}

function decodeInstrument(raw: JsonRecord, multiplier: number): DecodedInstrument | null {
  const gfoId = asNumber(raw.gfo_id);
  const type = raw.type;
  if (gfoId === null || typeof type !== "string") return null;
  const strike = asNumber(raw.strike_price);
  return {
    gfoId,
    symbol: symbolOf(raw, gfoId),
    name: typeof raw.name === "string" ? raw.name : "",
    type: type as DecodedInstrument["type"],
    expiryIso: isoFromStructured(raw.expiry),
    effectiveIso: isoFromStructured(raw.effective),
    strikePriceUsd: strike === null ? null : decodeScaledPrice(strike, multiplier),
    callPut: callPutOf(raw),
    tickTableUsd: decodeTickTable(raw.tick_table, multiplier),
  };
}

export class InstrumentCatalog {
  private readonly byId = new Map<number, DecodedInstrument>();
  private readonly bySymbol = new Map<string, DecodedInstrument>();
  readonly futures: DecodedInstrument[] = [];
  readonly options: DecodedInstrument[] = [];
  readonly strategies: DecodedInstrument[] = [];

  static async load(client: RtfpClient, underlying: string = "BTC"): Promise<InstrumentCatalog> {
    const raw = await client.getInstruments(underlying);
    const catalog = new InstrumentCatalog();
    const multiplier = firstCurrencyMultiplier(raw);
    for (const category of ["futures", "options", "strategies"] as const) {
      const records = Array.isArray(raw[category]) ? (raw[category] as JsonRecord[]) : [];
      for (const record of records) {
        const decoded = decodeInstrument(record, multiplier);
        if (!decoded) continue;
        catalog.byId.set(decoded.gfoId, decoded);
        catalog.bySymbol.set(decoded.symbol.toUpperCase(), decoded);
        if (decoded.type === "F") catalog.futures.push(decoded);
        else if (decoded.type === "O") catalog.options.push(decoded);
        else catalog.strategies.push(decoded);
      }
    }
    return catalog;
  }

  /** Look up one instrument by gfo_id, symbol, or (fuzzy) name prefix. */
  find(query: string | number): DecodedInstrument | null {
    if (typeof query === "number") return this.byId.get(query) ?? null;
    const text = query.trim();
    const asNumberKey = Number(text);
    if (Number.isInteger(asNumberKey) && this.byId.has(asNumberKey)) {
      return this.byId.get(asNumberKey)!;
    }
    const symbolHit = this.bySymbol.get(text.toUpperCase());
    if (symbolHit) return symbolHit;
    const prefix = text.toUpperCase();
    return (
      [...this.bySymbol.values()].find((i) => i.symbol.toUpperCase().startsWith(prefix)) ?? null
    );
  }

  /** Instrument symbol for a contract_number, or the raw id when unknown. */
  symbolFor(gfoId: number): string {
    return this.byId.get(gfoId)?.symbol ?? String(gfoId);
  }
}

function firstCurrencyMultiplier(raw: Record<string, JsonRecord[]>): number {
  for (const records of Object.values(raw)) {
    const first = records.find((r) => r.currency_multiplier !== undefined);
    const multiplier = first ? asNumber(first.currency_multiplier) : null;
    if (multiplier !== null) return multiplier;
  }
  return 10; // Observed value for BTC on GFO-X.
}
