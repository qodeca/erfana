#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# The Claude Code gate (spec 024 024-FR-016, 024-NFR-004): runs Claude Code
# three times on each locked sample, each run in a new project folder outside
# the repository with a new session and the one fixed prompt, then checks the
# runs and writes specs/spec-t3-024-unified-comments/verification/claude-code-gate.md.
# See README.md in this folder.
set -euo pipefail

readonly RUNS=3
readonly TOOLS='Read,Edit,Write,Glob,Grep'
readonly FILE_NAME='notes.md'

usage() {
  cat <<'EOF'
Usage: run-gate.sh <runs-folder>

  <runs-folder>  A new or empty folder OUTSIDE the repository. Each run gets
                 <runs-folder>/<sample>/run-<n>/project/ as its project folder.

Environment:
  ANTHROPIC_API_KEY  When set, runs use --bare (no user config at all).
                     Otherwise --safe-mode --setting-sources project, which
                     keeps the subscription login.
  GATE_MODEL         Optional --model value; by default the CLI's default model.

Exits non-zero when a check or the gate fails; the report is written either way.
EOF
}

die() {
  printf 'run-gate: %s\n' "$*" >&2
  exit 1
}

# Native path for node on Windows (Git Bash), unchanged elsewhere.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

check_lock() {
  local gate_dir="$1" sample name hash
  for sample in "$gate_dir"/samples/*.md; do
    name="$(basename "$sample")"
    hash="$(sha256sum "$sample" | cut -d' ' -f1)"
    grep -q "\"samples/${name}\": \"${hash}\"" "$gate_dir/gate.lock.json" || die "$name does not match gate.lock.json"
  done
}

check_flags() {
  local help flag
  help="$(claude --help 2>&1)"
  for flag in "$@"; do
    [[ "$flag" == --* ]] || continue
    grep -q -- "$flag" <<<"$help" || die "this claude has no $flag"
  done
}

# run_pass <run-dir> <pass>: one new session in <run-dir>/project.
run_pass() {
  local dir="$1" pass="$2" start end s0 s1 code=0
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  s0="$(date +%s)"
  (cd "$dir/project" && claude "${CLAUDE_ARGS[@]}") >"$dir/pass-$pass.jsonl" 2>"$dir/pass-$pass.stderr" </dev/null || code=$?
  s1="$(date +%s)"
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -f "$dir/project/$FILE_NAME" ]]; then cp "$dir/project/$FILE_NAME" "$dir/after-$pass.md"; fi
  printf 'start=%s\nend=%s\nseconds=%s\nexit=%s\n' "$start" "$end" "$((s1 - s0))" "$code" >"$dir/pass-$pass.meta"
  printf '%s pass %s: exit %s, %ss\n' "${dir#"$OUT/"}" "$pass" "$code" "$((s1 - s0))"
}

main() {
  if [[ $# -ne 1 ]]; then usage >&2; exit 2; fi
  if [[ "$1" == -h || "$1" == --help ]]; then usage; exit 0; fi
  command -v claude >/dev/null 2>&1 || die 'claude is not on PATH'

  local gate_dir repo_root
  gate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "$(git -C "$gate_dir" rev-parse --show-toplevel)" && pwd)"
  local parent
  parent="$(cd "$(dirname "$1")" && pwd)" || die "the parent of $1 does not exist"
  OUT="$parent/$(basename "$1")"
  if [[ "$OUT/" == "$repo_root/"* ]]; then die 'the runs folder must be outside the repository'; fi
  mkdir -p "$OUT"
  [[ -z "$(ls -A "$OUT")" ]] || die "$OUT is not empty: every run needs a fresh folder"
  check_lock "$gate_dir"

  local prompt isolation
  prompt="$(<"$gate_dir/prompt.txt")"
  local -a iso_args
  # The isolation text goes into the Markdown report; its backticks are code spans, not command substitution.
  # shellcheck disable=SC2016
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    iso_args=(--bare)
    isolation='`--bare` (API key; no hooks, skills, plugins, MCP servers, auto memory, CLAUDE.md or user settings are read)'
  else
    iso_args=(--safe-mode --setting-sources project)
    isolation='`--safe-mode --setting-sources project` (subscription login kept; CLAUDE.md, skills, plugins, hooks, MCP servers and auto memory off, user and local settings not read, the project folder has none)'
  fi
  CLAUDE_ARGS=(-p "$prompt" "${iso_args[@]}" --tools "$TOOLS" --allowedTools "$TOOLS" --permission-mode dontAsk
    --strict-mcp-config --no-session-persistence --disable-slash-commands --output-format stream-json --verbose)
  if [[ -n "${GATE_MODEL:-}" ]]; then CLAUDE_ARGS+=(--model "$GATE_MODEL"); fi
  check_flags "${CLAUDE_ARGS[@]}"

  claude --version >"$OUT/cli-version.txt"
  printf '%s\n' "$isolation" >"$OUT/isolation.txt"
  printf 'claude %s\n' "$(printf '%q ' "${CLAUDE_ARGS[@]}")" >"$OUT/command.txt"
  local dirty=''
  [[ -z "$(git -C "$repo_root" status --porcelain)" ]] || dirty=' (with uncommitted changes)'
  printf '%s%s\n' "$(git -C "$repo_root" rev-parse HEAD)" "$dirty" >"$OUT/commit.txt"
  uname -srm >"$OUT/system.txt"

  local sample name passes n p dir
  for sample in "$gate_dir"/samples/*.md; do
    name="$(basename "$sample" .md)"
    passes=1
    [[ "$name" == *run-twice* ]] && passes=2
    for ((n = 1; n <= RUNS; n++)); do
      dir="$OUT/$name/run-$n"
      mkdir -p "$dir/project"
      cp "$sample" "$dir/before.md"
      cp "$sample" "$dir/project/$FILE_NAME"
      for ((p = 1; p <= passes; p++)); do run_pass "$dir" "$p"; done
    done
  done

  cd "$repo_root"
  GATE_RUNS_DIR="$(native_path "$OUT")" npx vitest --run --config vitest.main.config.ts --project main \
    src/main/services/comments/markdown/markdownGate.test.ts
}

main "$@"
