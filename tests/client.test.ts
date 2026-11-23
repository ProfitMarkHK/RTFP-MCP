import { describe, expect, test } from "bun:test";

import {
  nextOffset,
  RtfpClient,
  RtfpError,
  splitWindows,
  type JsonRecord,
  type Transport,
} from "../src/client.js";

const noSleep = async (): Promise<void> => {};

interface Call {
  url: string;
  params: Record<string, string | number>;
}

/** Transport scripted by endpoint: returns pages in order, records calls. */
function scriptedTransport(
  pagesByEndpoint: Record<string, { status?: number; body: unknown }[]>,
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();
  const transport: Transport = async (url, params) => {
    const endpoint = url.replace(/^.*\//, "");
    calls.push({ url, params });
    const pages = pagesByEndpoint[endpoint] ?? [];
    const index = Math.min(cursors.get(endpoint) ?? 0, pages.length - 1);
    cursors.set(endpoint, index + 1);
    const page = pages[index];
    return { status: page?.status ?? 200, body: page?.body ?? { result: [] } };
  };
  return { transport, calls };
}

function bodyWith(result: JsonRecord[], next = ""): { body: unknown } {
  return { body: { result, next } };
}

function makeClient(transport: Transport): RtfpClient {
  return new RtfpClient({ transport, sleepMs: noSleep, maxRetries: 3 });
}

describe("pagination", () => {
  test("never follows the next URL: only its start offset is reused", async () => {
    const { transport, calls } = scriptedTransport({
      trades: [
        bodyWith([{ trade_id: "1" }], "https://wrong-host:9999/trades?start=500"),
        bodyWith([{ trade_id: "2" }], "https://wrong-host:9999/trades?start=1000"),
        bodyWith([], "https://wrong-host:9999/trades?start=1000"),
      ],
    });
    const client = makeClient(transport);
    const records = await client.getPage("trades", { underlying: "BTC" });

    expect(records).toEqual([{ trade_id: "1" }, { trade_id: "2" }]);
    // Every request went to the original endpoint and base URL.
    expect(calls.map((c) => c.url).every((u) => u.includes("marketdata.gfo-x.com"))).toBe(true);
    expect(calls[1]?.params.start).toBe(500);
  });

  test("stops on an empty result even though next stays non-empty", async () => {
    const { transport } = scriptedTransport({
      trades: [
        bodyWith([{ trade_id: "1" }], "https://marketdata.gfo-x.com:38973/trades?start=500"),
        bodyWith([], "https://marketdata.gfo-x.com:38973/trades?start=500"),
      ],
    });
    const records = await makeClient(transport).getPage("trades", {});
    expect(records).toEqual([{ trade_id: "1" }]);
  });

  test("nextOffset tolerates junk and falls back to the current offset", () => {
    expect(nextOffset("https://x/trades?start=750", {})).toBe(750);
    expect(nextOffset("https://x/trades?start=abc", { start: 250 })).toBe(250);
    expect(nextOffset("https://x/trades", { start: 250 })).toBe(250);
    expect(nextOffset("https://x/trades", {})).toBe(0);
  });
});

describe("retries", () => {
  test("backs off on 429 then succeeds", async () => {
    const { transport, calls } = scriptedTransport({
      trades: [
        { status: 429, body: {} },
        bodyWith([{ trade_id: "1" }]),
      ],
    });
    const records = await makeClient(transport).getPage("trades", {});
    expect(records).toEqual([{ trade_id: "1" }]);
    expect(calls.length).toBe(2);
  });

  test("backs off on 5xx then succeeds", async () => {
    const { transport } = scriptedTransport({
      trades: [
        { status: 502, body: {} },
        { status: 503, body: {} },
        bodyWith([{ trade_id: "1" }]),
      ],
    });
    const records = await makeClient(transport).getPage("trades", {});
    expect(records).toEqual([{ trade_id: "1" }]);
  });

  test("gives up after max_retries and surfaces the failure", async () => {
    const { transport, calls } = scriptedTransport({
      trades: [{ status: 500, body: {} }],
    });
    await expect(makeClient(transport).getPage("trades", {})).rejects.toThrow(RtfpError);
    expect(calls.length).toBe(3);
  });

  test("does not retry a 400 (bad window is not transient)", async () => {
    const { transport, calls } = scriptedTransport({
      trades: [{ status: 400, body: { error: "bad window" } }],
    });
    await expect(makeClient(transport).getPage("trades", {})).rejects.toThrow(
      /HTTP 400.*bad window/,
    );
    expect(calls.length).toBe(1);
  });
});

describe("window chunking", () => {
  test("splits ranges into <=300s windows", () => {
    expect(splitWindows(0, 300, 300)).toEqual([{ start: 0, end: 300 }]);
    expect(splitWindows(0, 301, 300)).toEqual([
      { start: 0, end: 300 },
      { start: 300, end: 301 },
    ]);
    expect(splitWindows(100, 1000, 300)).toHaveLength(3);
    expect(splitWindows(50, 50, 300)).toEqual([]);
  });

  test("chunks a 12-minute fetch into three windows", async () => {
    const { transport, calls } = scriptedTransport({
      trades: [
        bodyWith([{ trade_id: "a" }]),
        bodyWith([{ trade_id: "b" }]),
        bodyWith([{ trade_id: "c" }]),
      ],
    });
    const records = await makeClient(transport).fetchRange("trades", 1_000, 1_720, {
      underlying: "BTC",
    });
    expect(records.map((r) => r.trade_id)).toEqual(["a", "b", "c"]);
    const windows = calls.map((c) => [c.params.start_time, c.params.end_time]);
    expect(windows).toEqual([
      [1000, 1300],
      [1300, 1600],
      [1600, 1720],
    ]);
  });

  test("rejects an inverted range", async () => {
    const { transport } = scriptedTransport({ trades: [] });
    await expect(makeClient(transport).fetchRange("trades", 500, 500, {})).rejects.toThrow(
      /end_time must be after start_time/,
    );
  });

  test("caches closed windows and refetches only the trailing window", async () => {
    const { transport, calls } = scriptedTransport({ trades: [bodyWith([])] });
    const client = makeClient(transport);
    const past = Math.floor(Date.now() / 1000) - 3600;

    await client.fetchRange("trades", past, past + 600, {});
    expect(calls.length).toBe(2);
    calls.length = 0;

    // Same closed range again: served from the window cache.
    await client.fetchRange("trades", past, past + 600, {});
    expect(calls.length).toBe(0);
    calls.length = 0;

    // Overlapping range: closed windows cached, trailing window refetched.
    await client.fetchRange("trades", past, past + 900, {});
    expect(calls.length).toBe(1);
    expect(calls[0]?.params.start_time).toBe(past + 600);
  });
});
