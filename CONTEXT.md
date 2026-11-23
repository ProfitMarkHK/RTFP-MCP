# RTFP market data

This context is the GFO-X RTFP market-data domain as exposed to MCP clients: instruments, time-ranged events and current valuations. It keeps the venue's vocabulary distinct from the conventions of the server that relays it.

## Language

**Query-window policy**:
The venue's rules for asking about a slice of time: how large a requested range may be, how it is divided into queryable windows, when a window becomes immutable, and how a caller's time text is interpreted.
_Avoid_: request window, time slice, query range

**Orderbook snapshot**:
A contract's resting bids and asks at one instant, together with the book state and the venue's sequence reference for that instant.
_Avoid_: orderbook row, raw orderbook, book tick

**Order-flow event**:
One exchange message about an order or the book, identified by one of five message types: order book state, settlement price, opening price, order added or order deleted.
_Avoid_: fulltick row, tick record, full tick
