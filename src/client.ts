/**
 * RTFP HTTP client: retries, safe pagination, and 300-second window chunking.
 *
 * Two API bugs are worked around here (documented in docs/spec):
 *
 * 1. The `next` field can carry a *different* base URL than the request was
 *    sent to. We never follow it; we only extract the `start` offset and
 *    re-issue against the original endpoint.
 * 2. The `next` field stays non-empty after the final page. Pagination stops
 *    on an empty `result` instead.
 */

import { realClock } from "./clock.js";
import {
  type Clock,
  INVERTED_RANGE_MESSAGE,
  isClosedWindow,
  isInvertedRange,
  splitWindows,
  type Window,
} from "./query-window.js";

export const DEFAULT_BASE_URL = "https://marketdata.gfo-x.com:38973";

/** transport(url, params, timeoutMs) -> { status, body }. Throws on network errors. */
export type Transport = (
  url: string,
  params: Record<string, string | number>,
  timeoutMs: number,
) => Promise<{ status: number; body: unknown }>;

export class FetchTransport {
  private readonly controllerFactory: () => AbortController;

  constructor(controllerFactory?: () => AbortController) {
    this.controllerFactory = controllerFactory ?? (() => new AbortController());
  }

  async call(
    url: string,
    params: Record<string, string | number>,
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown }> {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    const controller = this.controllerFactory();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}?${qs}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class RtfpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RtfpError";
  }
}

export type JsonRecord = Record<string, unknown>;

export interface FetchJsonOptions {
  params: Record<string, string | number>;
  timeoutMs: number;
}

export interface RtfpClientOptions {
  baseUrl?: string;
  transport?: Transport;
  timeoutMs?: number;
  maxRetries?: number;
  sleepMs?: (ms: number) => Promise<void>;
  clock?: Clock;
}

export class RtfpClient {
  readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: Clock;
  private readonly windowCache = new Map<string, JsonRecord[]>();

  constructor(options: RtfpClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.transport = options.transport ?? ((u, p, t) => new FetchTransport().call(u, p, t));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.clock = options.clock ?? realClock;
    this.sleep =
      options.sleepMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  private endpointUrl(endpoint: string): string {
    return `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
  }

  /** GET one URL with exponential backoff for 429 / 5xx / transport errors. */
  private async fetchJson(endpoint: string, options: FetchJsonOptions): Promise<JsonRecord> {
    const url = this.endpointUrl(endpoint);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      let result: { status: number; body: unknown };
      try {
        result = await this.transport(url, options.params, this.timeoutMs);
      } catch (cause) {
        lastError = new RtfpError(`transport failure for ${url}`, { cause });
        await this.sleep(2 ** attempt * 10);
        continue;
      }
      const { status, body } = result;
      if (status === 429 || (status >= 500 && status < 600)) {
        lastError = new RtfpError(`HTTP ${status} from ${url}`);
        await this.sleep(2 ** attempt * 10);
        continue;
      }
      if (status >= 400) {
        throw new RtfpError(`HTTP ${status} from ${url}: ${JSON.stringify(body)}`);
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new RtfpError(`unexpected JSON body from ${url}`);
      }
      return body as JsonRecord;
    }
    throw new RtfpError(`failed after ${this.maxRetries} attempts: ${url}`, {
      cause: lastError,
    });
  }

  /** Fetch every page of an endpoint, avoiding the known `next` bugs. */
  private async getPages(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<JsonRecord[]> {
    const results: JsonRecord[] = [];
    let data = await this.fetchJson(endpoint, { params, timeoutMs: this.timeoutMs });
    results.push(...resultList(data));
    let guard = 0;
    while (typeof data.next === "string" && data.next !== "") {
      if (++guard > 10_000) throw new RtfpError("pagination did not terminate");
      const nextParams = { ...params, start: nextOffset(data.next, params) };
      data = await this.fetchJson(endpoint, { params: nextParams, timeoutMs: this.timeoutMs });
      const page = resultList(data);
      if (page.length === 0) break; // API bug: next persists after the last page.
      results.push(...page);
    }
    return results;
  }

  /** Raw instrument_dict result (futures / options / strategies). */
  async getInstruments(underlying: string = "BTC"): Promise<Record<string, JsonRecord[]>> {
    const data = await this.fetchJson("instrument_dict", {
      params: { underlying },
      timeoutMs: this.timeoutMs,
    });
    const result: unknown = data.result;
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new RtfpError("unexpected instrument_dict result");
    }
    return result as Record<string, JsonRecord[]>;
  }

  /** Single request honouring the 300-second window limit. */
  async getPage(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<JsonRecord[]> {
    return this.getPages(endpoint, params);
  }

  /**
   * Fetch a time range, chunking into <=300s windows; caches closed windows.
   * Closed windows are immutable, so only the trailing (still-open) window is
   * ever re-fetched.
   */
  async fetchRange(
    endpoint: string,
    startTime: number,
    endTime: number,
    params: Record<string, string | number> = {},
  ): Promise<JsonRecord[]> {
    if (isInvertedRange(startTime, endTime)) {
      throw new RtfpError(INVERTED_RANGE_MESSAGE);
    }
    const now = Math.floor(this.clock());
    const records: JsonRecord[] = [];
    for (const window of splitWindows(startTime, endTime)) {
      const cacheKey = rangeCacheKey(endpoint, params, window);
      const isClosed = isClosedWindow(window, now);
      if (isClosed && this.windowCache.has(cacheKey)) {
        records.push(...this.windowCache.get(cacheKey)!);
        continue;
      }
      const page = await this.getPages(endpoint, {
        ...params,
        start_time: window.start,
        end_time: window.end,
      });
      if (isClosed) this.windowCache.set(cacheKey, page);
      records.push(...page);
    }
    return records;
  }
}

function resultList(data: JsonRecord): JsonRecord[] {
  const result: unknown = data.result;
  if (!Array.isArray(result)) return [];
  return result as JsonRecord[];
}

/** Extract only the row offset from a `next` URL (its host may be wrong). */
export function nextOffset(
  nextUrl: string,
  params: Record<string, string | number>,
): number {
  try {
    const start = new URL(nextUrl, "https://placeholder.invalid").searchParams.get("start");
    if (start !== null && /^\d+$/.test(start)) return Number(start);
  } catch {
    // Fall through to the current offset.
  }
  const current = params.start;
  return typeof current === "number" ? current : 0;
}

function rangeCacheKey(
  endpoint: string,
  params: Record<string, string | number>,
  window: Window,
): string {
  const sorted = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join("&");
  return `${endpoint}?${sorted}&start_time=${window.start}&end_time=${window.end}`;
}
