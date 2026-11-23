#!/usr/bin/env bash
# RTFP-MCP quality gate runner.
# Runs every automated gate; exits non-zero on any failure.
set -uo pipefail

status=0
step() {
  echo ""
  echo "==> $1"
}
gate() {
  # gate <name> <command...>
  local name="$1"
  shift
  if "$@"; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    status=1
  fi
}

step "Lint (oxlint, deny warnings)"
gate "lint" bunx oxlint --deny-warnings src tests scripts examples

step "Shell lint (shellcheck)"
gate "shellcheck" shellcheck scripts/check-gates.sh scripts/audit.sh

step "Complexity budget (eslint complexity max 10, src only)"
gate "complexity" bun run complexity

step "Type check (tsc --noEmit, strict)"
gate "typecheck" bun run typecheck

step "Build (tsc -> dist/)"
gate "build" bun run build

step "Unit + protocol tests (bun test; live tests skipped)"
gate "tests" bun test

step "Dependency audit (high severity threshold)"
gate "audit" bash scripts/audit.sh

echo ""
if [ "$status" -eq 0 ]; then
  echo "ALL GATES GREEN"
else
  echo "GATES FAILED"
fi
exit "$status"
