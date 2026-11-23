/**
 * Query-window policy: the RTFP rules for asking about a slice of time.
 *
 * This module is the single, I/O-free home for the 300-second API window, the
 * 24-hour aggregate range cap, range/window decisions, validation messages,
 * and the interpretation of caller-supplied time parameters. It defines the
 * `Clock` type only; the real clock lives in the shell so the core stays pure.
 */

/** A now() adapter: Unix seconds (fractional allowed; callers floor as needed). */
export type Clock = () => number;

/** Maximum window accepted by a time-range endpoint. */
export const MAX_WINDOW_SECONDS = 300;

/** Maximum total range the server will chunk for one tool call. */
export const MAX_RANGE_SECONDS = 24 * 3600;

/** Exact validation message shared by the client, server and look-alike. */
export const INVERTED_RANGE_MESSAGE = "end_time must be after start_time";

/** Exact over-range message; the number comes from MAX_RANGE_SECONDS. */
export function rangeTooLargeMessage(): string {
  return (
    `time range exceeds ${MAX_RANGE_SECONDS}s; split into smaller ranges ` +
    "(the API allows 300s windows, this server chunks them for you)"
  );
}

export type Window = { start: number; end: number };

/** Split [start, end) into consecutive windows of at most MAX_WINDOW_SECONDS. */
export function splitWindows(start: number, end: number): Window[] {
  if (end <= start) return [];
  const windows: Window[] = [];
  let cursor = start;
  while (cursor < end) {
    const windowEnd = Math.min(cursor + MAX_WINDOW_SECONDS, end);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd;
  }
  return windows;
}

export function isInvertedRange(start: number, end: number): boolean {
  return end <= start;
}

export function exceedsMaxRange(start: number, end: number): boolean {
  return end - start > MAX_RANGE_SECONDS;
}

/** A window is immutable (and cacheable) once it ends strictly before now. */
export function isClosedWindow(window: Window, now: number): boolean {
  return window.end <= now - 1;
}

/** Europe/London offset in seconds for a given Unix time (BST +3600, GMT +0). */
export function londonOffsetSeconds(unixSec: number): number {
  // Format the date in Europe/London and compare with UTC to find the offset.
  const london = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = london.formatToParts(new Date(unixSec * 1000));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round(asUtc / 1000 - unixSec);
}

/**
 * Accept ISO-8601 (UTC- or offset-qualified) or Unix seconds; return Unix
 * seconds. Bare ISO strings without a timezone are interpreted as London
 * local time, matching how GFO-X traders speak about their session.
 */
export function parseTimeParam(value: string | number): number {
  if (typeof value === "number") return value;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const iso = text.replace("Z", "+00:00");
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`unrecognised time: ${text}`);
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  if (hasZone) return Math.floor(parsed.getTime() / 1000);
  const offset = londonOffsetSeconds(Math.floor(parsed.getTime() / 1000));
  return Math.floor(parsed.getTime() / 1000) - offset;
}

/** London trading-session window (07:30-17:30 Europe/London) as UTC Unix seconds. */
export function londonMarketWindowUtc(day: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`expected YYYY-MM-DD date, got: ${day}`);
  const [, y, m, d] = match;
  const open = Date.UTC(Number(y), Number(m) - 1, Number(d), 7, 30) / 1000;
  const close = Date.UTC(Number(y), Number(m) - 1, Number(d), 17, 30) / 1000;
  return {
    start: open - londonOffsetSeconds(open),
    end: close - londonOffsetSeconds(close),
  };
}
