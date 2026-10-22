#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# A/B driver for docs/performance/terminal-output-batching.md.
#
# Runs the flood benchmark against the terminal sources of the base commit
# (before) and of HEAD (after), with the same benchmark files for both, then
# restores HEAD's sources. Interleave rounds to cancel out machine drift:
#
#   sh docs/performance/terminal-output-batching.ab.sh r1 3
#   sh docs/performance/terminal-output-batching.ab.sh r2 3
#
# Window in front (default): e2e/terminal-output.bench.ts through Playwright.
# ERFANA_BENCH_HIDE=minimize|cover|none: e2e/fixtures/terminalHiddenFloodDriver.cjs
# drives the app from its own main process instead, because Playwright turns
# background throttling off and keeps the page "visible" (see that file).
#
# Refuses to run on a dirty tree. Writes JSON to .local/bench/.
set -eu
ROOT=$(git rev-parse --show-toplevel)
BASE=${ERFANA_BENCH_BASE:-origin/develop}
HIDE=${ERFANA_BENCH_HIDE:-}
OUT=${ERFANA_BENCH_OUT:-$ROOT/.local/bench}

if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
  echo "terminal-output-batching.ab.sh: the working tree has changes; commit or set them aside first" >&2
  exit 1
fi
# Every source file the fix modified, tests excluded. Files the fix ADDED stay
# in place for "before"; nothing at the base commit imports them.
FILES=$(git -C "$ROOT" diff --name-only --diff-filter=M "$BASE" HEAD -- src | grep -v '\.test\.' | grep -v '__' || true)
if [ -z "$FILES" ]; then
  echo "terminal-output-batching.ab.sh: no modified source files between $BASE and HEAD; nothing to compare" >&2
  exit 1
fi

# On exit, put back HEAD's version of each swapped file, but only if it still
# holds exactly the base version this script checked out. A file edited during
# the run is left alone and named, never silently overwritten.
restore() {
  for f in $FILES; do
    if git -C "$ROOT" diff --quiet "$BASE" -- "$f"; then
      git -C "$ROOT" checkout HEAD -- "$f"
    elif ! git -C "$ROOT" diff --quiet HEAD -- "$f"; then
      echo "terminal-output-batching.ab.sh: $f was edited during the run; left as it is" >&2
    fi
  done
}

run() {
  (cd "$ROOT" && npx electron-vite build > /dev/null)
  if [ -z "$HIDE" ]; then
    (cd "$ROOT" && ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL="$1" ERFANA_BENCH_RUNS="$2" \
      npx playwright test --project=bench --workers=1 --reporter=list e2e/terminal-output.bench.ts)
    return
  fi
  mkdir -p "$OUT" "$ROOT/.e2e-temp/terminal-bench-project"
  echo '# Notes' > "$ROOT/.e2e-temp/terminal-bench-project/notes.md"
  i=1
  while [ "$i" -le "$2" ]; do
    userdata=$(mktemp -d "$ROOT/.e2e-temp/terminal-bench-userdata-XXXXXX")
    result=$(cd "$ROOT" && NODE_ENV=development ERFANA_E2E_FAST_SHELL=1 ERFANA_E2E_TEST_HOOKS=1 \
      ERFANA_BENCH_PROJECT="$ROOT/.e2e-temp/terminal-bench-project" ERFANA_BENCH_HIDE="$HIDE" \
      ./node_modules/.bin/electron -r ./e2e/fixtures/terminalHiddenFloodDriver.cjs . \
        --user-data-dir="$userdata" --use-mock-keychain 2>/dev/null | grep -E '^BENCH_(RESULT|ERROR)' || true)
    rm -rf "$userdata"
    echo "[$1 run $i] $result"
    case "$result" in
      BENCH_RESULT*) echo "${result#BENCH_RESULT }" > "$OUT/terminal-output-$1-$HIDE-$i-$(date +%s).json" ;;
      *) echo "terminal-output-batching.ab.sh: run $i failed" >&2; exit 1 ;;
    esac
    i=$((i + 1))
  done
}

# shellcheck disable=SC2086
git -C "$ROOT" checkout "$BASE" -- $FILES
trap restore EXIT
run "before-$1" "$2"
restore
trap - EXIT
run "after-$1" "$2"
