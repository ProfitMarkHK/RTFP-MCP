# Quality gates for RTFP-MCP

The single source of truth for what **done-done** means in this project. Any
team member should be able to run these checks and know the answer. Keep this
file in sync with the tooling. An out-of-date checklist is a bug.

## Run everything

```bash
bun run check
```

(`scripts/check-gates.sh`; exits non-zero on any failure, so it also works in
pre-commit hooks and merge automation.)

For each language-specific lint gate, record the exact command, settings
file, tool prerequisite or module installation, minimum version if relevant,
any intentional rule exclusions, and whether missing tooling fails closed.
Syntax or parser checks do not replace linting. Gate 3 includes the
complexity budget: strict max cyclomatic complexity 10 per function/method,
tests excluded, no grandfathering.

- TypeScript lint: `bunx oxlint --deny-warnings src tests scripts examples`
  (oxlint ≥ 1.93, devDependency, fails closed via `--deny-warnings`).
- Complexity budget: `eslint src` — flat config `eslint.config.js` sets
  `complexity: ["error", { max: 10 }]` with `files: ["src/**/*.ts"]`, so
  source is scoped and tests are excluded. oxlint has no complexity rule, so
  ESLint (devDependency, with `typescript-eslint` for the TS parser) exists
  for exactly this gate. Verified to fail on violations (probe function with
  complexity 12 rejected).
- Shell lint: `shellcheck scripts/check-gates.sh scripts/audit.sh`
  (ShellCheck 0.11.0 on PATH; fails closed).

## Gates

| # | Gate | State | Command / note |
|---|------|-------|----------------|
| 1 | All tests pass | applies | `bun test` (69 tests across 8 files; live tests auto-skipped) |
| 2 | End-to-end / acceptance tests pass | applies | `tests/mock-integration.test.ts` drives the full client stack against the bundled RTFP look-alike (`src/mock-server.ts`) over real HTTP — window limit, multi-page pagination via the wrong-host/never-empty `next` bug, instrument filtering, quote widening, Black76-consistent valuations — in the default suite; `tests/server.test.ts` drives the server through the real MCP protocol via `InMemoryTransport`; `RTFP_MOCK=1 bun run smoke` drives stdio → HTTP → look-alike; `RTFP_LIVE=1 bun run test:live` exercises the deployed endpoints (needs office network / VPN *and* the venue up) |
| 3 | Linters / formatters / static analysis pass (incl. complexity ≤ 10, tests excluded) | applies | oxlint (`bun run lint`), ESLint complexity (`bun run complexity`), shellcheck — all inside `bun run check` |
| 4 | New code covered by non-trivial tests | applies | manual review — tests cover the API's known bugs (wrong-host `next`, never-empty `next`), window chunking, closed-window caching, retry/backoff, quote widening, decoding edges, put-call parity, IV round-trip |
| 5 | Documentation updated | applies | manual review — README, this checklist, AGENTS.md |
| 6 | Type checking passes | applies | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| 7 | Build / compile succeeds | applies | `tsc` → `dist/` |
| 8 | Security / secrets checks pass | applies | `scripts/audit.sh`: lockfile snapshot + `npm audit --audit-level=high` (bun 1.4 has no `pm audit`; `bun pm scan` needs a configured scanner package). No credentials in the repo: the RTFP API needs no auth. |
| 9 | Change reviewed | applies | manual — independent reviewer re-runs gates before merge |
| 10 | Tracker / ticket reconciled | no-op | no issue tracker is attached to this project yet |
| 11 | Implementation aligns with functional & technical specs | applies | manual review vs `docs/spec/rtfp-openapi.json` + `docs/spec/GFO-X_External_Market_Data_Rest_API_v1.7.md` (the machine-precise OpenAPI schema and the official API reference) |
| 12 | Agent skill structure validates | no-op | no `SKILL.md` in this repo |

State legend: **applies** (must pass), **no-op** (does not apply, reason
given), **gap** (should apply but not yet possible, tracked as work).

## No-ops and gaps

- Gate 10 (tracker): no-op — the project has no linked tracker; nothing to
  reconcile against yet.
- Gate 12 (agent skills): no-op — the repo contains no Agent Skill
  directories.
- Gap — CI: the project has no remote or CI config yet. The runner is
  pre-commit/local only. Wire `bun run check` into CI when the repo gets a
  remote.
- Gap — live acceptance: the RTFP venue itself is currently down, and even
  when up its endpoints are only reachable from the office network / GFO-X
  VPN. E2E is covered by three layers that run anywhere: the mock-integration
  suite against the bundled RTFP look-alike (real HTTP, faithful wire formats
  and API bugs), the demo transport over real stdio, and the protocol tests
  with faithful fakes. Re-run `RTFP_LIVE=1 bun run test:live` from the office
  network when the venue is back, before relying on live numbers.
- Gate 8 threshold, stated explicitly: advisories at **high severity or
  above** fail the gate; low/moderate are reported but tolerated.

## When a gate fails

Fix the code, not the gate. Diagnose the failure, fix all failures in the
same session where practical, and re-run until every gate is green. Never
weaken a check to force a pass.
