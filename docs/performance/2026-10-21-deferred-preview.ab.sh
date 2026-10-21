#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# A/B driver for docs/performance/2026-10-21-deferred-preview.md.
#
# Runs e2e/preview-typing.bench.ts against the preview sources of the harness
# commit (before) and of HEAD (after), with the same benchmark file for both,
# then restores HEAD's sources. Interleave rounds to cancel out machine drift:
#
#   sh docs/performance/2026-10-21-deferred-preview.ab.sh r1 3
#   sh docs/performance/2026-10-21-deferred-preview.ab.sh r2 3
#   node docs/performance/2026-10-21-deferred-preview.aggregate.mjs .local/bench
#
# Needs a clean working tree for the four files below. Writes JSON to .local/bench/.
set -eu
ROOT=$(git rev-parse --show-toplevel)
BASE=${ERFANA_BENCH_BASE:-372ae6fc}   # "perf: add a typing benchmark for the Markdown preview"
FILES="src/renderer/src/components/Editor/MarkdownPreview.tsx
src/renderer/src/components/Editor/MermaidDiagram.tsx
src/renderer/src/components/Editor/MarkdownEditorPanel/hooks/useScrollSync.ts
src/renderer/src/utils/previewRenderTiming.ts"

run() {
  (cd "$ROOT" && npx electron-vite build > /dev/null)
  (cd "$ROOT" && ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL="$1" ERFANA_BENCH_RUNS="$2" \
    npx playwright test --project=bench --workers=1 --reporter=list)
}

# shellcheck disable=SC2086
git -C "$ROOT" checkout "$BASE" -- $FILES
trap 'git -C "$ROOT" checkout HEAD -- $FILES' EXIT
run "before-$1" "$2"
# shellcheck disable=SC2086
git -C "$ROOT" checkout HEAD -- $FILES
run "after-$1" "$2"
