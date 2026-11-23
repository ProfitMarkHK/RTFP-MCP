import { describe, expect, test } from "bun:test";

import {
  exceedsMaxRange,
  INVERTED_RANGE_MESSAGE,
  isClosedWindow,
  isInvertedRange,
  londonMarketWindowUtc,
  londonOffsetSeconds,
  MAX_RANGE_SECONDS,
  parseTimeParam,
  rangeTooLargeMessage,
  splitWindows,
} from "../src/query-window.js";

describe("window chunking", () => {
  test("splits ranges into <=300s windows", () => {
    expect(splitWindows(0, 300)).toEqual([{ start: 0, end: 300 }]);
    expect(splitWindows(0, 301)).toEqual([
      { start: 0, end: 300 },
      { start: 300, end: 301 },
    ]);
    expect(splitWindows(100, 1000)).toHaveLength(3);
    expect(splitWindows(50, 50)).toEqual([]);
  });
});

describe("range validation", () => {
  test("applies the inverted and 24h rules with the shared messages", () => {
    expect(isInvertedRange(100, 100)).toBe(true);
    expect(isInvertedRange(100, 99)).toBe(true);
    expect(isInvertedRange(100, 101)).toBe(false);
    expect(exceedsMaxRange(0, MAX_RANGE_SECONDS)).toBe(false);
    expect(exceedsMaxRange(0, MAX_RANGE_SECONDS + 1)).toBe(true);
    expect(INVERTED_RANGE_MESSAGE).toBe("end_time must be after start_time");
    expect(rangeTooLargeMessage()).toBe(
      "time range exceeds 86400s; split into smaller ranges " +
        "(the API allows 300s windows, this server chunks them for you)",
    );
  });

  test("treats a window as closed only once it ends before now", () => {
    expect(isClosedWindow({ start: 0, end: 10 }, 11)).toBe(true);
    expect(isClosedWindow({ start: 0, end: 10 }, 10)).toBe(false);
  });
});

describe("parseTimeParam", () => {
  test("passes through Unix seconds", () => {
    expect(parseTimeParam(1739964606)).toBe(1739964606);
    expect(parseTimeParam("1739964606")).toBe(1739964606);
  });

  test("parses UTC ISO strings", () => {
    expect(parseTimeParam("2025-02-19T11:30:06Z")).toBe(1739964606);
  });

  test("interprets bare ISO as London local time", () => {
    // 11:30 London on 2025-02-19 is GMT (UTC+0): same as 11:30 UTC.
    expect(parseTimeParam("2025-02-19T11:30:06")).toBe(1739964606);
    // 10:10 London on 2026-04-16 is BST (UTC+1): 09:10 UTC.
    expect(parseTimeParam("2026-04-16T10:10:06")).toBe(parseTimeParam("2026-04-16T09:10:06Z"));
  });

  test("respects explicit offsets", () => {
    expect(parseTimeParam("2025-02-19T12:30:06+01:00")).toBe(1739964606);
  });

  test("rejects nonsense", () => {
    expect(() => parseTimeParam("not a time")).toThrow();
  });
});

describe("londonMarketWindowUtc", () => {
  test("shifts the session window by the London offset", () => {
    // GMT day: 07:30-17:30 UTC.
    const gmt = londonMarketWindowUtc("2026-01-15");
    expect(gmt.end - gmt.start).toBe(10 * 3600);
    expect(new Date(gmt.start * 1000).toISOString()).toBe("2026-01-15T07:30:00.000Z");

    // BST day: 06:30-16:30 UTC.
    const bst = londonMarketWindowUtc("2026-04-16");
    expect(new Date(bst.start * 1000).toISOString()).toBe("2026-04-16T06:30:00.000Z");
    expect(bst.end - bst.start).toBe(10 * 3600);
  });

  test("rejects non-date input", () => {
    expect(() => londonMarketWindowUtc("16 April 2026")).toThrow();
  });
});

describe("londonOffsetSeconds", () => {
  test("is zero in GMT and one hour in BST", () => {
    expect(londonOffsetSeconds(Date.parse("2026-01-15T12:00:00Z") / 1000)).toBe(0);
    expect(londonOffsetSeconds(Date.parse("2026-04-16T12:00:00Z") / 1000)).toBe(3600);
  });
});
