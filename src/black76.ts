/**
 * Black76 pricing for cash-settled futures options.
 *
 * GFO-X BTC products are cash-settled futures options, so Black76 is the
 * natural model: the "underlying" is the futures price F, not BTC spot.
 * No external math library is required - the normal CDF uses erf.
 */

/** Standard normal CDF via the error function. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Abramowitz & Stegun 7.1.26 rational approximation of erf (|eps| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
}

export interface Black76Params {
  /** Futures price F. */
  futurePrice: number;
  /** Strike K. */
  strike: number;
  /** Time to expiry in years. */
  timeToExpiryYears: number;
  /** Risk-free rate r (annualised, continuous). */
  rate: number;
  /** Implied volatility (annualised). */
  volatility: number;
  callPut: "C" | "P";
}

export type ImpliedVolParams = Omit<Black76Params, "volatility"> & {
  /** Observed option price the solved volatility must match. */
  marketPrice: number;
};

/** Black76 option price on a futures contract. */
export function black76Price(params: Black76Params): number {
  const { futurePrice, strike, timeToExpiryYears: t, rate, volatility, callPut } = params;
  if (t <= 0 || volatility <= 0 || futurePrice <= 0 || strike <= 0) return 0;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(futurePrice / strike) + 0.5 * volatility ** 2 * t) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discount = Math.exp(-rate * t);
  if (callPut === "C") {
    return discount * (futurePrice * normCdf(d1) - strike * normCdf(d2));
  }
  return discount * (strike * normCdf(-d2) - futurePrice * normCdf(-d1));
}

/** Black76 vega (identical for calls and puts). */
export function black76Vega(params: Black76Params): number {
  const { futurePrice, strike, timeToExpiryYears: t, rate, volatility } = params;
  if (t <= 0 || volatility <= 0 || futurePrice <= 0 || strike <= 0) return 0;
  const d1 =
    (Math.log(futurePrice / strike) + 0.5 * volatility ** 2 * t) / (volatility * Math.sqrt(t));
  return futurePrice * Math.exp(-rate * t) * normPdf(d1) * Math.sqrt(t);
}

export interface ImpliedVolOptions {
  /** Bisection bounds; market prices outside them clamp to the bound. */
  minVol?: number;
  maxVol?: number;
  tolerance?: number;
  maxIterations?: number;
}

interface VolBounds {
  low: number;
  high: number;
  tolerance: number;
  maxIterations: number;
}

type VolParams = Omit<Black76Params, "volatility">;

/** Bisection bounds for a solvable market price, or null if unsolvable. */
function solvableBounds(
  base: VolParams,
  marketPrice: number,
  options: ImpliedVolOptions,
): VolBounds | null {
  if (marketPrice <= 0) return null;
  const bounds: VolBounds = {
    low: options.minVol ?? 1e-4,
    high: options.maxVol ?? 5,
    tolerance: options.tolerance ?? 1e-6,
    maxIterations: options.maxIterations ?? 100,
  };
  const priceAt = (vol: number): number =>
    black76Price({ ...base, volatility: vol }) - marketPrice;
  // The price is monotone in vol: solvable only when it straddles the bounds.
  if (priceAt(bounds.low) > 0 || priceAt(bounds.high) < 0) return null;
  return bounds;
}

/** Bisect the volatility that reprices to `marketPrice`. */
function bisectVol(base: VolParams, marketPrice: number, bounds: VolBounds): number {
  let { low, high } = bounds;
  for (let i = 0; i < bounds.maxIterations; i++) {
    const mid = (low + high) / 2;
    const fMid = black76Price({ ...base, volatility: mid }) - marketPrice;
    if (Math.abs(fMid) < bounds.tolerance) return mid;
    if (fMid < 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Solve for the Black76 implied volatility matching `marketPrice`. */
export function black76ImpliedVol(
  params: ImpliedVolParams,
  options: ImpliedVolOptions = {},
): number | null {
  const { marketPrice, ...base } = params;
  const bounds = solvableBounds(base, marketPrice, options);
  if (!bounds) return null;
  return bisectVol(base, marketPrice, bounds);
}
