# Agent Instructions

This file gives context to AI coding agents working in this repository.

## Project

RTFP-MCP is a Model Context Protocol server (TypeScript, bun, Anthropic's
`@modelcontextprotocol/sdk`) exposing the GFO-X RTFP market data API: BTC
futures, options and strategies. It was ported from the `rtfp-api` Python
skill; the wire-format rules live in `src/decode.ts` and `src/client.ts`, and
the canonical spec is `docs/spec/` (OpenAPI schema + official API reference).

## Conventions

- Runtime: bun (`bun run …`). Build/typecheck: `tsc` (strict).
- Tests: `bun test`. Live-endpoint tests are gated behind `RTFP_LIVE=1`.
- The domain rules that must never be violated (see the skill's hard-won
  lessons): structured timestamps are `unix_sec * 1e9 + seq` (decode via
  BigInt for strings; `options_valuation.exchange_timestamp` is plain
  seconds); `instrument_dict` static prices are scaled by
  `10 ** currency_multiplier` but live endpoint prices are already USD; the
  orderbook is the source of truth for *current* price (never substitute
  `statistics.last_price`); `next` URLs are never followed, only their
  `start` offset is reused, and pagination stops on an empty result; the
  time-range endpoints cap at 300-second windows.

<!-- BEGIN QUALITY GATES (managed) -->
## Definition of done. Quality gates

No task is **done-done** (safe to merge, ship, or close) until every applicable
quality gate below passes. Gates catch regressions and omissions. They do not
replace design or review judgement.

Run all gates with one command before marking any unit of work complete:

```bash
bun run check
```

The full, project-specific checklist lives in
[`docs/quality-gates.md`](docs/quality-gates.md). It names every gate, its
exact command, and the gates that are no-ops or gaps for this project. Keep it
current. Out-of-sync documentation is a bug.

Rules when a gate fails:

- Fix the code, not the gate. Do not weaken a test, silence a linter, or skip
  a doc update to force a green result.
- Fix all failures in the same session where practical, then re-run until every
  gate is green.
- Never commit or push secrets, even transiently.
<!-- END QUALITY GATES (managed) -->
