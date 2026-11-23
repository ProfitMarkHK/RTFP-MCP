#!/usr/bin/env bash
# Dependency vulnerability audit, high-severity threshold.
#
# bun (1.4) has no built-in `pm audit`; `bun pm scan` requires a configured
# scanner package. We instead resolve a package-lock snapshot (no install)
# and run npm's advisory audit against it, failing on >= high severity.
set -euo pipefail

npm install --package-lock-only --silent --no-audit --no-fund >/dev/null
npm audit --audit-level=high
