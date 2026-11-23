# RTFP-MCP

[Model Context Protocol](https://modelcontextprotocol.io) server for the GFO-X
RTFP market data API — live **BTC futures, options and strategies** data
available to any MCP client (Claude Code, Claude Desktop, OpenCode, Cursor,
…).

Built on Anthropic's official MCP TypeScript SDK
([`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)),
ported from the `rtfp-api` skill's Python scripts.

## Why

The RTFP API is easy to get wrong: nanosecond structured timestamps,
`currency_multiplier` price scaling, a 300-second query-window limit, a
`next` pagination URL that points at the wrong host and never empties, and
two different notions of "price" (current quote vs last traded). This server
encodes all of that domain knowledge once, so an assistant just calls a tool.

## Tools

| Tool | What it does |
|---|---|
| `get_instruments` | Decoded catalog: symbols, gfo_id, expiry, strike USD, tick tables |
| `find_instrument` | Resolve symbol / name prefix / gfo_id to one instrument |
| `get_recent_trades` | Last N executed trades, decoded and symbol-enriched |
| `get_trades` | Trades in a time range (auto-chunked into 300s windows) |
| `get_current_quotes` | Latest bid/ask/mid per futures contract (orderbook = source of truth, sparse contracts auto-widened to 300s) |
| `get_orderbook` | Raw orderbook snapshots in a range |
| `get_statistics` | OHLC + volume per contract (`last_price` = last *traded*, not current) |
| `get_fulltick` | Order-flow events (A/D/O/S/T) in a range |
| `get_options_valuation` | Option prices, IV and greeks, joined with the catalog |
| `black76_price` | Price a cash-settled futures option (Black76) |
| `black76_implied_vol` | Solve implied vol from a market price |

Conventions the server handles for you:

- Structured timestamps (`unix_sec * 1e9 + sequence`) → ISO-8601 UTC strings.
- `instrument_dict` scaled prices → USD via `10 ** currency_multiplier`.
- Time parameters accept ISO-8601 or Unix seconds; **bare ISO is London time**.
- Range queries chunk into 300s windows; closed windows are cached (only the
  trailing window is re-fetched).
- Pagination avoids both known `next`-URL bugs (wrong host; never empties).
- Every response is stamped `fetched_at` so data freshness is disclosed.

## Install & run

Requires [bun](https://bun.sh) (Node ≥ 20 also works for the compiled
`dist/`).

```bash
cd RTFP-MCP
bun install
bun run build
```

### Register with an MCP client

Claude Code:

```bash
claude mcp add rtfp-mcp -- bun run /Users/barryg/Git/RTFP-MCP/src/index.ts
```

OpenCode (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "mcp": {
    "rtfp": {
      "type": "local",
      "command": ["bun", "run", "/Users/barryg/Git/RTFP-MCP/src/index.ts"]
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`): use `bun` as the executable
with `run /path/to/RTFP-MCP/dist/index.js` as args.

Environment:

- `RTFP_BASE_URL` — override the API base URL (default
  `https://marketdata.gfo-x.com:38973`).
- `RTFP_DEMO=1` — serve canned data instead of the live API. The live
  endpoints are reachable only from the office network / GFO-X VPN; demo mode
  lets you exercise the full server offline.

### Try it

```bash
# Offline end-to-end over real stdio: handshake, list tools, call tools.
RTFP_DEMO=1 bun run smoke

# Live tests against the real endpoints (needs office network / VPN).
RTFP_LIVE=1 bun run test:live
```

## Development

```bash
bun run check   # every automated quality gate (exits non-zero on failure)
```

The gate list, commands, no-ops and gaps live in
[`docs/quality-gates.md`](docs/quality-gates.md). No unit of work is
done-done until every applicable gate passes.

Layout:

```
src/decode.ts     timestamp/price decoding rules (the tricky part of RTFP)
src/client.ts     HTTP client: retries, safe pagination, 300s-window chunking
src/catalog.ts    decoded instrument catalog (session-cached)
src/market.ts     workflows: recent trades, current quotes, enrichment
src/black76.ts    Black76 pricing + bisection IV solver (no math deps)
src/server.ts     MCP tool surface (Anthropic SDK McpServer + zod schemas)
src/demo.ts       canned responses for RTFP_DEMO=1
tests/            bun test: unit + in-memory MCP protocol E2E + live smoke
docs/spec/        the RTFP OpenAPI schema and API reference (the spec gates 11)
```

## License

MIT
