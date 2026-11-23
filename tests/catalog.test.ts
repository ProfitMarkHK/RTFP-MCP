import { describe, expect, test } from "bun:test";

import { InstrumentCatalog } from "../src/catalog.js";
import { RtfpClient, type JsonRecord, type Transport } from "../src/client.js";

const FUTURE_EXPIRY = 1766592000000000000n; // 2025-12-24T16:00:00Z (settlement time)

function instrumentDict(): { body: unknown } {
  const future: JsonRecord = {
    type: "F",
    name: "BTCF-241225",
    gfo_id: 5169,
    symbol: "GFBTF241225",
    currency_multiplier: 10,
    tick_table: [{ tick_size: 50_000_000_000, upper_limit: 0 }],
    expiry: String(FUTURE_EXPIRY),
    effective: String(FUTURE_EXPIRY - 86400n * 90n * 10n ** 9n),
  };
  const option: JsonRecord = {
    type: "O",
    name: "BTCC-241225-90000",
    gfo_id: 6001,
    symbol: "GFBTO24122590000.00C",
    currency_multiplier: 10,
    strike_price: 900_000_000_000_000,
    call_put: "C",
    tick_table: [
      { tick_size: 1_000_000_000, upper_limit: 100 },
      { tick_size: 10_000_000_000, upper_limit: 0 },
    ],
    expiry: String(FUTURE_EXPIRY),
    effective: String(FUTURE_EXPIRY - 86400n * 90n * 10n ** 9n),
  };
  return {
    body: { result: { futures: [future], options: [option], strategies: [] } },
  };
}

function catalogClient(transport: Transport): RtfpClient {
  return new RtfpClient({ transport, sleepMs: async () => {} });
}

const okTransport: Transport = async () => instrumentDict();

describe("InstrumentCatalog", () => {
  test("decodes scaled strikes, tick sizes and structured expiry", async () => {
    const catalog = await InstrumentCatalog.load(catalogClient(okTransport));
    const future = catalog.futures[0]!;

    expect(future.gfoId).toBe(5169);
    expect(future.symbol).toBe("GFBTF241225");
    expect(future.expiryIso).toBe("2025-12-24T16:00:00Z");
    expect(future.strikePriceUsd).toBeNull();
    // 5_000_000_000 with multiplier 10 -> 5.0 USD tick.
    expect(future.tickTableUsd).toEqual([{ tickSizeUsd: 5, upperLimitUsd: null }]);

    const option = catalog.options[0]!;
    expect(option.strikePriceUsd).toBe(90_000);
    expect(option.callPut).toBe("C");
    // Multi-tier tick table: upper_limit 0 means "no upper limit".
    expect(option.tickTableUsd).toEqual([
      { tickSizeUsd: 0.1, upperLimitUsd: 100 },
      { tickSizeUsd: 1, upperLimitUsd: null },
    ]);
  });

  test("categorises futures, options and strategies", async () => {
    const catalog = await InstrumentCatalog.load(catalogClient(okTransport));
    expect(catalog.futures).toHaveLength(1);
    expect(catalog.options).toHaveLength(1);
    expect(catalog.strategies).toHaveLength(0);
    expect(catalog.options[0]!.type).toBe("O");
  });

  test("finds by symbol, name prefix and gfo_id", async () => {
    const catalog = await InstrumentCatalog.load(catalogClient(okTransport));

    expect(catalog.find("GFBTF241225")?.gfoId).toBe(5169);
    expect(catalog.find("gfbtf241225")?.gfoId).toBe(5169); // case-insensitive
    expect(catalog.find("GFBTF")?.gfoId).toBe(5169); // symbol prefix
    expect(catalog.find("5169")?.gfoId).toBe(5169); // numeric string
    expect(catalog.find(6001)?.gfoId).toBe(6001); // numeric id
    expect(catalog.find("NOPE")).toBeNull();
  });

  test("symbolFor falls back to the raw id for unknown contracts", async () => {
    const catalog = await InstrumentCatalog.load(catalogClient(okTransport));
    expect(catalog.symbolFor(5169)).toBe("GFBTF241225");
    expect(catalog.symbolFor(999999)).toBe("999999");
  });

  test("rejects a malformed instrument_dict result", async () => {
    const badTransport: Transport = async () => ({ status: 200, body: { result: [] } });
    await expect(InstrumentCatalog.load(catalogClient(badTransport))).rejects.toThrow(
      /unexpected instrument_dict/,
    );
  });
});
