CONFIDENTIAL

External Market Data REST API

Version: 1.7

Date: 28 October 2025

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

Version 1.7

10

Contents

1

Introduction ........................................................................................................................................... 4

1.1  Introduction .......................................................................................................................................................................................... 4

1.2  Support .................................................................................................................................................................................................... 4

1.3  Document History ............................................................................................................................................................................ 4

2  APIs .......................................................................................................................................................... 5

2.1  instrument_dict ................................................................................................................................................................................ 5

2.1.1  Parameters .................................................................................................................................................................................. 5

2.1.2  HTTP Response Status Codes ........................................................................................................................................ 5

2.1.3  Sample cURL Command ................................................................................................................................................... 5

2.1.4 Sample Output .......................................................................................................................................................................... 5

2.2 trades ........................................................................................................................................................................................................ 7

2.2.1  Parameters .................................................................................................................................................................................. 7

2.2.2 HTTP Response Status Codes ........................................................................................................................................ 8

2.2.3 Sample cURL Command ................................................................................................................................................... 8

2.2.4 Sample Output .......................................................................................................................................................................... 8

2.3 orderbook .............................................................................................................................................................................................. 9

2.3.1  Parameters .................................................................................................................................................................................. 9

2.3.2 HTTP Response Status Codes ........................................................................................................................................ 9

2.3.3 Sample cURL Command ................................................................................................................................................. 10

2.3.4 Sample Output ........................................................................................................................................................................ 10

2.4 statistics .................................................................................................................................................................................................. 11

2.4.1 Parameters .................................................................................................................................................................................. 11

2.4.2 HTTP Response Status Code ........................................................................................................................................... 11

2.4.3 Sample cURL Command ................................................................................................................................................. 12

2.4.4 Sample Output ........................................................................................................................................................................ 12

2.5 fulltick ...................................................................................................................................................................................................... 13

2.5.1 Parameters ................................................................................................................................................................................ 13

2.5.2 HTTP Response Status Codes ...................................................................................................................................... 13

2.5.3 Sample curl command .................................................................................................................................................... 13

2.5.4 Sample Output ........................................................................................................................................................................ 14

2.6 options_valuation ......................................................................................................................................................................... 14

2.6.1 Parameters ................................................................................................................................................................................ 14

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

2 |

Version 1.7

10

2.6.2 HTTP Response Status Code ......................................................................................................................................... 15

2.6.3 Sample cURL Command ................................................................................................................................................. 15

2.6.4 Sample Output ........................................................................................................................................................................ 15

3  Best Practices on API Usage .............................................................................................................. 17

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

3 |

Version 1.7

10

1

1.1

Introduction

Introduction

The external market data REST API is for querying market data and related information within a

given time period either by underlying or instrument ID.

The following endpoints are available for querying:

•  instrument_dict
•  trades
•  orderbook
•  statistics
•  fulltick
•  options_valuation

An interactive web version of this API documentation can also be accessed by querying the
/docs endpoint.

1.2  Support

GFO-X provides technical support coverage. Any technical question should be directed to

GFO-X Technical Support:

Email: TPS@gfo-x.com

Tel: +44 203 207 0880

1.3  Document History

Revision  Date

Sections Updated  Notes

1.0

1.1

1.2

1.3

1.4

1.5

1.6

1.7

28 May 2024  All

Initial revision

11 Jun 2024

TOC

Added table of contents

6 Dec 2024

All

11 Dec 2024

1.2

21 Feb 2025

2.1.3, 2.1.4, 2.2.3, 2.2.4,
2.3.3, 2.3.4, 2.4.3, 2.4.4,
2.5.3, 2.5.4

5 Mar 2025

1.1, 2.6

6 Mar 2025

2.2.1, 2.2.2, 2.3.1, 2.3.2,
2.4.1, 2.4.2, 2.5.1, 2.5.2

28 Oct 2025

2.1.4

•
•
•

•

•

•

•

•

Added the max time period for data query.
Included best practices on API usage.
Document re-formatted to align with GFO-X template

Added support phone number.

Refreshed Sample cURL Command and Output

Added options_valuation endpoint description

Updated HTTP response status code for start_time and
end_time errors.

Add example that includes decimal contract_multiplier

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

4 |

Version 1.7

10

2  APIs

2.1

instrument_dict

Endpoint: GET /instrument_dict

•  GFO-X does not add/remove Instrument intraday. One query at the start of trading day is

sufficient to retrieve all necessary instrument information.

2.1.1  Parameters

Parameter

Description

underlying

Underlying name. Default value is BTC and currently we only have one underlying.

2.1.2  HTTP Response Status Codes

Status Code

Description

200

500

Successful request

Unknown internal server error happens

2.1.3  Sample cURL Command
curl -X 'GET' \
  'http://0.0.0.0:38972/instrument_dict?underlying=BTC' \
  -H 'accept: application/json'

2.1.4  Sample Output
{
  "result": {
    "futures": [
      {
        "type": "F",
        "name": "GFO-X BTC Mini Weekly Futures W2",
        "gfo_id": 6115,
        "parent_id": 6107,
        "symbol": "GMBF2251114",
        "isin": "GB00X8S1JD7O",
        "settlement_type": "CASH",
        "trade_currency": "USD",
        "currency_multiplier": 10,
        "tick_table": [
          {
            "tick_size": 50000000000,
            "upper_limit": 0
          }
        ],
        "expiry": "1763136000000000000",
        "effective": "1761523200000000000",

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

5 |

Version 1.7

10

        "size_multiplier": "0.1",
        "contract_multiplier": "0.1",
        "cfi_code": "FFICSX"
      },
      {
        "type": "F",
        "name": "GFO-X Bitcoin Futures",
        "gfo_id": 15,
        "parent_id": 3,
        "symbol": "GFBTF251031",
        "isin": "GB00XWWRPEGX",
        "settlement_type": "CASH",
        "trade_currency": "USD",
        "currency_multiplier": 10,
        "tick_table": [
          {
            "tick_size": 50000000000,
            "upper_limit": 0
          }
        ],
        "expiry": "1761926400000000000",
        "effective": "1753660800000000000",
        "size_multiplier": "1",
        "contract_multiplier": "1.0",
        "cfi_code": "FFICSX"
      }
    ],
    "options": [
      {
        "type": "O",
        "name": "GFO-X Bitcoin Daily Options",
        "gfo_id": 6818,
        "parent_id": 2529,
        "symbol": "GDBTO251103150000.00P",
        "isin": "GB00XQC9QIPD",
        "settlement_type": "CASH",
        "trade_currency": "USD",
        "currency_multiplier": 10,
        "tick_table": [
          {
            "tick_size": 10000000000,
            "upper_limit": 100000000000
          },
          {
            "tick_size": 100000000000,
            "upper_limit": 0
          }
        ],
        "expiry": "1762185600000000000",
        "effective": "1761609600000000000",
        "size_multiplier": "1",
        "contract_multiplier": "1.0",
        "cfi_code": "OPEICS",
        "strike_price": 1500000000000000,
        "exercise_type": "E",
        "call_put": "P"
      },
    "strategies": [
      {

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

6 |

Version 1.7

10

        "type": "S",
        "name": "GFO-X Bitcoin Futures Roll",
        "gfo_id": 414,
        "parent_id": 2,
        "symbol": "GFBTFS251031-251128",
        "isin": "",
        "settlement_type": "CASH",
        "trade_currency": "USD",
        "currency_multiplier": 10,
        "tick_table": [
          {
            "tick_size": 50000000000,
            "upper_limit": 0
          }
        ],
        "expiry": "1761926400000000000",
        "effective": "1759104000000000000",
        "strategy": [
          {
            "leg_instrument_id": 15,
            "leg_volume": -1
          },
          {
            "leg_instrument_id": 16,
            "leg_volume": 1
          }
        ]
      }
    ]
  }
}
Not

Notes:

The currency_multiplier (m) is effective in the form of 10m. All price values are returned as
multiples of 10m in the responses. i.e. a strike_price of 830,000,000,000,000 and a
currency_multiplier of 10 indicates the strike_price carries a decimal value of
830,000,000,000,000 / 1010 = 83,000.

2.2  trades

Endpoint: GET /trades

2.2.1  Parameters

Parameter

Description

underlying

Underlying name. Default value is BTC and currently we only have one

underlying.

instrument_id

Optional field to query by a particular instrument id.

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

7 |

Version 1.7

10

start_time

Required field denoting the starting value of the time range to be queried. Value

should be Unix timestamp (seconds).

end_time

Required field denoting the end value of the time range to be queried. Value

start

limit

should be Unix timestamp (seconds).

Not required. Value indicates page number together with the limit value.

Not required. Denotes the maximum number of results to be returned. Default

value is currently 1500.

2.2.2  HTTP Response Status Codes

Status Code

Description

200

400

500

Successful request

If start_time >= end_time, or (end_time – start_time) > 300 seconds

Unknown internal server error happens

2.2.3  Sample cURL Command
curl -X 'GET' \
'http://0.0.0.0:38972/trades?start_time=1710313949&end_time=1710313940&underlyi
ng=BTC&start=0' \
  -H 'accept: application/json'

2.2.4  Sample Output
{
    "result": [
        {
            "timestamp": 1739964606000000000,
            "contract_number": 10084,
            "passive_order_id": 123,
            "aggressor_order_id": 124,
            "trade_id": 1083,
            "aggressor_side": "B",
            "quantity_executed": 6190.0,
            "trade_price": 43690.0,
            "trading_session": "C",
            "trade_type": "N",
            "leg_count": 1,
            "sub_trade_id": 1
        },
        {
            "timestamp": 1739964606000000001,
            "contract_number": 10084,
            "passive_order_id": 123,
            "aggressor_order_id": 124,
            "trade_id": 1083,
            "aggressor_side": "B",
            "quantity_executed": 6190.0,

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

8 |

Version 1.7

10

            "trade_price": 43690.0,
            "trading_session": "C",
            "trade_type": "N",
            "leg_count": 1,
            "sub_trade_id": 1
        },
        {
            "timestamp": 1739964606000000002,
            "contract_number": 10084,
            "passive_order_id": 123,
            "aggressor_order_id": 124,
            "trade_id": 1083,
            "aggressor_side": "B",
            "quantity_executed": 6190.0,
            "trade_price": 43690.0,
            "trading_session": "C",
            "trade_type": "N",
            "leg_count": 1,
            "sub_trade_id": 1
        }
    ],
    "limit": 10,
    "next": ""
}

2.3  orderbook

Endpoint: GET /orderbook

2.3.1  Parameters

Parameter

underlying

Description

Underlying name. Default value is BTC and currently we only have one

underlying.

instrument_id

Optional field to query by a particular instrument id.

start_time

Required field denoting the starting value of the time range to be queried.

Value should be Unix timestamp (seconds)

end_time

Required field denoting the end value of the time range to be queried. Value

start

limit

should be Unix timestamp (seconds).

Not required. Value indicates page number together with the limit value.

Not required. Denotes the maximum number of results to be returned.

Default value is currently 1500.

2.3.2  HTTP Response Status Codes

Status Code

Description

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

9 |

Version 1.7

10

200

400

500

Successful request

If start_time >= end_time, or (end_time – start_time) > 300 seconds

Unknown internal server error happens

2.3.3  Sample cURL Command
curl -X 'GET' \
'http://0.0.0.0:38972/orderbook?start_time=1710313949&end_time=1710313940&under
lying=BTC&start=0' \
  -H 'accept: application/json'

2.3.4  Sample Output
{
    "result": [
        {
            "timestamp": 1739964872000000003,
            "contract_number": 11768,
            "state": "O",
            "num_of_bids": 1,
            "bids": [
                {
                    "quantity": 66.0,
                    "price": 836.04335
                }
            ],
            "num_of_asks": 1,
            "asks": [
                {
                    "quantity": 1.3,
                    "price": 877.8455175
                }
            ],
            "full_tick_reference_sequence": 817728
        },
        {
            "timestamp": 1739964872000000004,
            "contract_number": 11768,
            "state": "O",
            "num_of_bids": 1,
            "bids": [
                {
                    "quantity": 66.0,
                    "price": 836.04335
                }
            ],
            "num_of_asks": 1,
            "asks": [
                {
                    "quantity": 1.3,
                    "price": 877.8455175
                }
            ],
            "full_tick_reference_sequence": 817728

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

10 |

Version 1.7

10

        },
        {
            "timestamp": 1739964872000000005,
            "contract_number": 11768,
            "state": "O",
            "num_of_bids": 1,
            "bids": [
                {
                    "quantity": 66.0,
                    "price": 836.04335
                }
            ],
            "num_of_asks": 1,
            "asks": [
                {
                    "quantity": 1.3,
                    "price": 877.8455175
                }
            ],
            "full_tick_reference_sequence": 817728
        }
    ],
    "limit": 10,
    "next": ""
}

2.4  statistics

Endpoint: GET /statistics

2.4.1  Parameters

Parameter

Description

underlying

Underlying name. Default value is BTC and currently we only have one underlying.

instrument_id

Optional field to query by a particular instrument id.

start_time

Required field denoting the starting value of the time range to be queried. Value

should be Unix timestamp (seconds).

end_time

Required field denoting the end value of the time range to be queried. Value

should be Unix timestamp (seconds).

start

Not required. Value indicates page number together with the limit value.

2.4.2  HTTP Response Status Code

Status Code

Description

200

400

Successful request

If start_time >= end_time, or (end_time – start_time) > 300 seconds

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

11 |

Version 1.7

10

500

Unknown internal server error happens

2.4.3  Sample cURL Command
curl -X 'GET' \
'http://0.0.0.0:38972/statistics?start_time=1710313949&end_time=1710313940&unde
rlying=BTC&start=0' \
  -H 'accept: application/json'

2.4.4  Sample Output
{
    "result": [
        {
            "timestamp": 1739964998000000000,
            "contract_number": 10000003,
            "open_price": 4700.0,
            "high_price": 4850.0,
            "low_price": 4750.0,
            "last_price": 4820.0,
            "reference_price": 4750.0,
            "last_volume": 10.0,
            "total_volume": 1000.0,
            "total_number_of_trades": 5000,
            "open_interest": 210000000000
        },
        {
            "timestamp": 1739964998000000001,
            "contract_number": 10000003,
            "open_price": 4700.0,
            "high_price": 4850.0,
            "low_price": 4750.0,
            "last_price": 4820.0,
            "reference_price": 4750.0,
            "last_volume": 10.0,
            "total_volume": 1000.0,
            "total_number_of_trades": 5000,
            "open_interest": 210000000000
        },
        {
            "timestamp": 1739964998000000002,
            "contract_number": 10000003,
            "open_price": 4700.0,
            "high_price": 4850.0,
            "low_price": 4750.0,
            "last_price": 4820.0,
            "reference_price": 4750.0,
            "last_volume": 10.0,
            "total_volume": 1000.0,
            "total_number_of_trades": 5000,
            "open_interest": 210000000000
        }
    ],
    "limit": 10,
    "next": ""
}

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

12 |

Version 1.7

10

2.5  fulltick

Endpoint: GET /fulltick

Fulltick contains 5 different types of messages identified by the message_type single character
field. The message types are:

•  Order book state (T)
•  Settlement price (S)
•  Opening price (O)
•  Order added (A)
•  Order deleted (D)

2.5.1  Parameters

Parameter

Description

underlying

Underlying name. Default value is BTC and currently we only have one

underlying.

instrument_id

Optional field to query by a particular instrument id.

start_time

Required field denoting the starting value of the time range to be queried. Value

should be Unix timestamp (seconds).

end_time

Required field denoting the end value of the time range to be queried. Value

start

limit

should be Unix timestamp (seconds).

Not required. Value indicates page number together with the limit value.

Not required. Denotes the maximum number of results to be returned. Default

value is currently 1500.

2.5.2  HTTP Response Status Codes

Status Code

Description

200

400

500

Successful request

If start_time >= end_time, or (end_time – start_time) > 300 seconds

Unknown internal server error happens

2.5.3  Sample curl command
curl -X 'GET' \
'http://0.0.0.0:38972/fulltick?start_time=1710313949&end_time=1710313940&underl
ying=BTC&start=0' \
  -H 'accept: application/json'

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

13 |

Version 1.7

10

2.5.4  Sample Output
{
    "result": [
        {
            "message_type": "A",
            "timestamp": 1739965213000000000,
            "contract_number": 10000003,
            "order_id": 1000,
            "volume": 10.0,
            "price": 10.1,
            "side": "B",
            "type": "G"
        },
        {
            "message_type": "D",
            "timestamp": 1739965213000000000,
            "contract_number": 10000003,
            "order_id": 1000,
            "side": "B",
            "remaining": 100.1
        },
        {
            "message_type": "O",
            "timestamp": 1739965213000000000,
            "contract_number": 10000003,
            "volume": 0.0010000003,
            "price": 1234.5
        },
        {
            "message_type": "S",
            "timestamp": 1739965213000000000,
            "contract_number": 10000003,
            "price": 1234.5
        },
        {
            "message_type": "T",
            "timestamp": 1739965213000000000,
            "contract_number": 10000003,
            "state": "C"
        }
    ],
    "limit": 5,
    "next":
"https://0.0.0.0:38972/fulltick?underlying=BTC&start_time=1739965213&end_time
=1739965214&start=5&limit=5"
}

2.6  options_valuation

Endpoint: GET /options_valuation

(This endpoint will incur extra costs in the near future, subject to further notice.)

2.6.1  Parameters

Parameter

Description

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

14 |

Version 1.7

10

underlying

Underlying name. Default value is BTC and currently we only have one underlying.

start

limit

Not required. Value indicates page number together with the limit value.

Not required. Denotes the maximum number of results to be returned. Default

value is currently 1500.

2.6.2  HTTP Response Status Code

Status Code

Description

200

500

Successful request

Unknown internal server error happens

2.6.3  Sample cURL Command
curl -X 'GET' \
  'https://0.0.0.0:38972/options_valuation?underlying=BTC&start=0&limit=3' \
  -H 'accept: application/json'

2.6.4  Sample Output
{
  "result": [
    {
      "exchange_timestamp": 1739892305,
      "contract_number": 5625,
      "underlying_future_price": 96216.24995547986,
      "option_price": 93.14225401364097,
      "option_implied_volatility": 0.9135198954933654,
      "option_greeks": {
        "delta": -0.008914849583605207,
        "gamma": 8.491988186138759e-7,
        "vega": 7.481556727657394
      }
    },
    {
      "exchange_timestamp": 1739892305,
      "contract_number": 5626,
      "underlying_future_price": 96216.24995547986,
      "option_price": 46099.182284559094,
      "option_implied_volatility": 0.9135198954933654,
      "option_greeks": {
        "delta": 0.9865367518523205,
        "gamma": 8.491988186138759e-7,
        "vega": 7.481556727657394
      }
    }
  ],
  "limit": 2,
  "next":
"https://0.0.0.0:39872/options_valuation?underlying=BTC&start=2&limit=2"
}

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

15 |

Version 1.7

10

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

16 |

Version 1.7

10

3  Best Practices on API Usage

This GFO-X Real Time Market Data Feed is designed for real-time data query, not historical

data query. It is optimized to handle short lookback times. There is a restriction to limit the time

range of a request to no more than 5 minutes.

The following is the access pattern GFO-X expects:

•  GFO-X prefers queries per underlying, as a single request gets all contracts for an

underlying.

•  Queries should be made no more than the order of one request per second, with look
back time on the order of one second. Deviation from this pattern is acceptable but

should be restricted to the case when client has missed data and would like to catch

up to the current state.

•  While the API can handle a decent throughput, it is advised not to connect with more

than 3 clients simultaneously.

•

Instruments do not change during the day (no instrument is added or deleted), so one

instrument dictionary query on startup should be good for usage for the day.

If you are expecting a different or specific usage pattern, please contact GFO-X.

Global Futures and Options Ltd, Incorporated in the United Kingdom, Registration 13018987

Authorised and Regulated by the Financial Conduct Authority, FRN 945035

17 |

