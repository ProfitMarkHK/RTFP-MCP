/**
 * Canned RTFP responses for demo mode (RTFP_DEMO=1).
 *
 * The live GFO-X endpoints are reachable only from the office network or
 * VPN. Demo mode lets anyone exercise the full server - handshake, tools,
 * decoding - offline, using the same wire formats as the real API.
 */

import type { Transport } from "./client.js";

const FUTURE_EXPIRY = 1766592000000000000n; // 2025-12-24T16:00:00Z
const NOW = 1766590000; // fixed "now" so demo data is internally consistent

function instruments(): unknown {
  return {
    result: {
      futures: [
        {
          type: "F",
          name: "BTCF-241225",
          gfo_id: 5169,
          symbol: "GFBTF241225",
          currency_multiplier: 10,
          tick_table: [{ tick_size: 50_000_000_000, upper_limit: 0 }],
          expiry: String(FUTURE_EXPIRY),
        },
        {
          type: "F",
          name: "BTCF-260626",
          gfo_id: 5170,
          symbol: "GFBTF260626",
          currency_multiplier: 10,
          tick_table: [{ tick_size: 50_000_000_000, upper_limit: 0 }],
          expiry: String(FUTURE_EXPIRY + 86400n * 184n * 10n ** 9n),
        },
      ],
      options: [
        {
          type: "O",
          name: "BTCC-241225-90000",
          gfo_id: 6001,
          symbol: "GFBTO24122590000.00C",
          currency_multiplier: 10,
          strike_price: 900_000_000_000_000,
          call_put: "C",
          expiry: String(FUTURE_EXPIRY),
        },
      ],
      strategies: [],
    },
  };
}

function trades(): unknown {
  const base = [
    { trade_id: "T-1001", price: 74_260, qty: 2, side: "B", offset: 30 },
    { trade_id: "T-1002", price: 74_250, qty: 1, side: "S", offset: 95 },
    { trade_id: "T-1003", price: 74_265, qty: 3, side: "B", offset: 210 },
  ];
  return {
    result: base.map((t) => ({
      timestamp: (NOW - t.offset) * 1e9,
      contract_number: 5169,
      trade_id: t.trade_id,
      aggressor_order_id: "A-1",
      passive_order_id: "P-1",
      aggressor_side: t.side,
      quantity_executed: t.qty,
      trade_price: t.price,
      trading_session: "C",
      trade_type: "N",
      leg_count: 1,
    })),
    next: "",
  };
}

function orderbook(): unknown {
  return {
    result: [
      {
        timestamp: (NOW - 2) * 1e9,
        contract_number: 5169,
        state: "O",
        num_of_bids: 2,
        num_of_asks: 2,
        bids: [
          { quantity: 5, price: 74_260 },
          { quantity: 8, price: 74_255 },
        ],
        asks: [
          { quantity: 3, price: 74_270 },
          { quantity: 6, price: 74_275 },
        ],
      },
    ],
    next: "",
  };
}

function statistics(): unknown {
  return {
    result: [
      {
        timestamp: NOW * 1e9,
        contract_number: 5169,
        open_price: 74_100,
        high_price: 74_310,
        low_price: 74_050,
        last_price: 74_265,
        reference_price: 74_260,
        last_volume: 3,
        total_volume: 152,
        total_number_of_trades: 41,
        open_interest: 1250,
      },
    ],
    next: "",
  };
}

function optionsValuation(): unknown {
  return {
    result: [
      {
        exchange_timestamp: NOW,
        contract_number: 6001,
        underlying_future_price: 74_260,
        option_price: 1234.5,
        option_implied_volatility: 0.91,
        option_greeks: { delta: 0.55, gamma: 0.00021, vega: 120.5 },
      },
    ],
    next: "",
  };
}

/** Demo transport: serves canned pages for every endpoint. */
export const demoTransport: Transport = async (url) => {
  const endpoint = url.replace(/^.*\//, "");
  switch (endpoint) {
    case "instrument_dict":
      return { status: 200, body: instruments() };
    case "trades":
      return { status: 200, body: trades() };
    case "orderbook":
      return { status: 200, body: orderbook() };
    case "statistics":
      return { status: 200, body: statistics() };
    case "options_valuation":
      return { status: 200, body: optionsValuation() };
    case "fulltick":
      return {
        status: 200,
        body: {
          result: [
            {
              timestamp: (NOW - 5) * 1e9,
              contract_number: 5169,
              message_type: "A",
              order_id: "O-77",
              volume: 4,
              price: 74_258,
              side: "B",
              type: "D",
            },
          ],
          next: "",
        },
      };
    default:
      return { status: 200, body: { result: [], next: "" } };
  }
};
