import { describe, expect, test } from "bun:test";

import {
  decodeScaledPrice,
  formatStructuredTs,
  londonMarketWindowUtc,
  parseTimeParam,
  structuredMillis,
  structuredToUnixSeconds,
  unixSecondsToIso,
} from "../src/decode.js";

describe("structured timestamps", () => {
  test("decodes unix seconds from the ns + sequence format", () => {
    // Spec sample: 1739964606 with sequence 0, 1, 2 (2025-02-19T11:30:06Z).
    expect(structuredToUnixSeconds(1739964606000000000n)).toBe(1739964606);
    expect(structuredToUnixSeconds(1739964606000000001n)).toBe(1739964606);
    expect(structuredToUnixSeconds(1739964606000000002n)).toBe(1739964606);
  });

  test("accepts string and number forms; strings are exact", () => {
    expect(structuredToUnixSeconds("1739964606000000000")).toBe(1739964606);
    // Number form: float64 rounding (~256ns) is far below one second.
    expect(structuredToUnixSeconds(1739964606000000000)).toBe(1739964606);
    expect(() => structuredToUnixSeconds(0)).toThrow();
    expect(() => structuredToUnixSeconds("abc")).toThrow();
    expect(() => structuredToUnixSeconds(-5n)).toThrow();
  });

  test("millisecond remainder comes from the ns sequence field", () => {
    expect(structuredMillis(1739964606000000000n)).toBe(0);
    expect(structuredMillis(1739964606093123456n)).toBe(93);
    expect(structuredMillis("1776321097093734938")).toBe(93);
    expect(structuredMillis(1739964606123456789n)).toBe(123);
  });

  test("renders UTC and London time", () => {
    // Skill sample: 2026-04-16 06:31:37.093 UTC is 07:31:37 BST London.
    expect(formatStructuredTs(1776321097093734938n)).toBe(
      "2026-04-16 06:31:37.093 UTC (07:31:37 London)",
    );
  });

  test("ISO rendering uses second precision", () => {
    expect(unixSecondsToIso(1739964606)).toBe("2025-02-19T11:30:06Z");
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

describe("decodeScaledPrice", () => {
  test("instrument_dict scaled prices decode via currency_multiplier", () => {
    // 50_000_000_000 with multiplier 10 -> 5.0 USD tick size (skill example).
    expect(decodeScaledPrice(50_000_000_000, 10)).toBe(5);
    // 900_000_000_000_000 with multiplier 10 -> 90,000 USD strike.
    expect(decodeScaledPrice(900_000_000_000_000, 10)).toBe(90_000);
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
