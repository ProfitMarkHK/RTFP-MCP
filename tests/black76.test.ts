import { describe, expect, test } from "bun:test";

import { black76ImpliedVol, black76Price, black76Vega, normCdf } from "../src/black76.js";

const base = {
  futurePrice: 74_260,
  strike: 90_000,
  timeToExpiryYears: 0.5,
  rate: 0.05,
  volatility: 0.9,
  callPut: "C" as const,
};

describe("normCdf", () => {
  test("matches the normal CDF at known points", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1)).toBeCloseTo(0.841345, 4);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 4);
    expect(normCdf(3)).toBeCloseTo(0.99865, 4);
  });
});

describe("black76Price", () => {
  test("deep OTM call is worth less than a near-the-money call", () => {
    const otm = black76Price(base);
    const atm = black76Price({ ...base, strike: 74_260 });
    expect(atm).toBeGreaterThan(otm);
    expect(otm).toBeGreaterThan(0);
  });

  test("put-call parity: C - P == e^-rT (F - K)", () => {
    const call = black76Price(base);
    const put = black76Price({ ...base, callPut: "P" });
    const parity = Math.exp(-base.rate * base.timeToExpiryYears) * (base.futurePrice - base.strike);
    expect(call - put).toBeCloseTo(parity, 6);
  });

  test("returns zero at or after expiry", () => {
    expect(black76Price({ ...base, timeToExpiryYears: 0 })).toBe(0);
    expect(black76Price({ ...base, volatility: 0 })).toBe(0);
  });

  test("matches an independently computed Black76 value", () => {
    // F=100, K=100, T=1, r=0, sigma=0.25: price = F * (2N(d1) - 1), d1 = sigma/2.
    const d1 = 0.125;
    const expected = 100 * (2 * normCdf(d1) - 1);
    expect(
      black76Price({
        futurePrice: 100,
        strike: 100,
        timeToExpiryYears: 1,
        rate: 0,
        volatility: 0.25,
        callPut: "C",
      }),
    ).toBeCloseTo(expected, 6);
  });
});

describe("black76Vega", () => {
  test("is positive for live options and zero at expiry", () => {
    expect(black76Vega(base)).toBeGreaterThan(0);
    expect(black76Vega({ ...base, timeToExpiryYears: 0 })).toBe(0);
  });
});

describe("black76ImpliedVol", () => {
  test("round-trips a Black76 price back to its volatility", () => {
    const marketPrice = black76Price(base);
    const solved = black76ImpliedVol({ ...base, marketPrice });
    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(0.9, 3);
  });

  test("solves puts as well as calls", () => {
    const putParams = { ...base, callPut: "P" as const, volatility: 1.4 };
    const marketPrice = black76Price(putParams);
    const solved = black76ImpliedVol({ ...putParams, marketPrice });
    expect(solved!).toBeCloseTo(1.4, 2);
  });

  test("returns null outside the achievable price range", () => {
    // Max call value ~ e^-rT * F; max put value ~ e^-rT * K.
    expect(black76ImpliedVol({ ...base, marketPrice: 1e9 })).toBeNull();
    expect(black76ImpliedVol({ ...base, callPut: "P", marketPrice: 1e6 })).toBeNull();
    expect(black76ImpliedVol({ ...base, marketPrice: -5 })).toBeNull();
    expect(black76ImpliedVol({ ...base, marketPrice: 0 })).toBeNull();
  });
});
