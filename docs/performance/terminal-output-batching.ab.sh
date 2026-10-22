#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# A/B driver for docs/performance/terminal-output-batching.md.
#
# Runs e2e/terminal-output.bench.ts against the terminal sources of the base
# commit (before) and of HEAD (after), with the same benchmark file for both,
# then restores HEAD's sources. Interleave rounds to cancel out machine drift:
#
#   sh docs/performance/terminal-output-batching.ab.sh r1 3
#   sh docs/performance/terminal-output-batching.ab.sh r2 3
#
# Needs a clean working tree for the files the fix modified. Writes JSON to .local/bench/.
set -eu
ROOT=$(git rev-parse --show-toplevel)
BASE=${ERFANA_BENCH_BASE:-origin/develop}
# Every source file the fix modified, tests excluded. Files the fix ADDED stay
# in place for "before"; nothing at the base commit imports them.
FILES=$(git -C "$ROOT" diff --name-only --diff-filter=M "$BASE" HEAD -- src | grep -v '\.test\.' | grep -v '__')

run() {
  (cd "$ROOT" && npx electron-vite build > /dev/null)
  (cd "$ROOT" && ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL="$1" ERFANA_BENCH_RUNS="$2" \
    npx playwright test --project=bench --workers=1 --reporter=list e2e/terminal-output.bench.ts)
}

# shellcheck disable=SC2086
git -C "$ROOT" checkout "$BASE" -- $FILES
trap 'git -C "$ROOT" checkout HEAD -- $FILES' EXIT
run "before-$1" "$2"
# shellcheck disable=SC2086
git -C "$ROOT" checkout HEAD -- $FILES
run "after-$1" "$2"
