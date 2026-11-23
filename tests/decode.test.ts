import { describe, expect, test } from "bun:test";

import {
  decodeScaledPrice,
  formatStructuredTs,
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

describe("decodeScaledPrice", () => {
  test("instrument_dict scaled prices decode via currency_multiplier", () => {
    // 50_000_000_000 with multiplier 10 -> 5.0 USD tick size (skill example).
    expect(decodeScaledPrice(50_000_000_000, 10)).toBe(5);
    // 900_000_000_000_000 with multiplier 10 -> 90,000 USD strike.
    expect(decodeScaledPrice(900_000_000_000_000, 10)).toBe(90_000);
  });
});
