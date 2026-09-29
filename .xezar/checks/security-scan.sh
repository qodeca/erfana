#!/usr/bin/env bash
# The security stage of the canonical gate run (`SDLC.md` § Security before the quality verdict).
#
# It is a GATE, not a ninth workflow step. The spine stays kit → preflight → setup → author →
# readiness → gates → evidence → handoff; this runs inside the gates entry point, right after the
# install and BEFORE every gate that produces a quality signal, so "security is resolved before
# any quality verdict" is the order the runner actually executes rather than a sentence people
# are asked to remember.
#
# WHAT IT PRODUCES. A structured result at `<attempt>/security.json` — the decision (does a code
# or security capability apply at all), the inventory it enumerated, one entry per check with
# `pass` / `findings` / `unknown` / `not-applicable`, and whether a named trust boundary changed.
# The seal refuses an attempt that carries no such result, and records its status, so a reviewer
# reads a fact rather than the author's summary of one.
#
# UNKNOWN IS NOT A PASS. The advisory database needs the network, and discovery must not require
# one, so a candidate that changes a lockfile records `unknown` for the dependency check. That is
# visible in the seal and in the review; it is never rewritten to "clean".
#
# Usage:
#   security-scan.sh               scan this candidate; write the result into the current gate
#                                  attempt when one is running, otherwise report only
#   security-scan.sh --out <file>  write the result to an explicit path
#   security-scan.sh --help
#
# Exit 0 when the stage resolved (pass, unknown or not-applicable). Exit 1 when it found
# something blocking, or when it could not look at all — a scan that cannot read its input has
# no opinion, and "no findings" would be a lie in the shape of a pass.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help | -h)
      printf 'usage: security-scan.sh [--out <file>]\n\n'
      printf '  Runs inside the canonical gates, before every quality gate. Writes the\n'
      printf '  structured security result into the current gate attempt, or to --out.\n'
      exit 0
      ;;
    --out)
      shift
      [ "$#" -gt 0 ] || { printf 'security-scan: --out needs a path\n' >&2; exit 2; }
      OUT="$1"
      ;;
    *)
      printf 'security-scan: unknown argument "%s"\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

resolve_task_paths || exit 1

# The attempt directory is exported by `repo-gates.sh`. Outside a gate run there is none, and a
# stage that wrote nowhere says so rather than pretending it was recorded.
if [ -z "$OUT" ] && [ -n "${GATE_ATTEMPT_DIR:-}" ]; then
  OUT="$GATE_ATTEMPT_DIR/security.json"
fi

# The same base the attempt record is bound to, resolved the same way. `repo-gates.sh` has
# already worked it out; recomputing it here would let the two disagree about which change set
# was scanned.
BASE_SHA="${GATE_BASE_SHA:-}"
if [ -z "$BASE_SHA" ]; then
  base_ref="origin/$BASE_BRANCH"
  git -C "$TASK_CWD" rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH" >/dev/null 2>&1 || base_ref="$BASE_BRANCH"
  BASE_SHA="$(git -C "$TASK_CWD" merge-base HEAD "$base_ref" 2>/dev/null || printf '')"
fi

# Why a DELIVERED/VERIFICATION run declares itself, and it is declared HERE because only the
# task's own records answer it. A run whose fix landed on the PR's own branch (`DELIVERED`, #402)
# or that only verified a revision it was never asked to change (`VERIFICATION`, §7d) legitimately
# carries no commits of its own — readiness is documented to accept exactly those two shapes with an
# empty branch. An empty change set resolves as `not-applicable` on its own, so the declaration no
# longer decides the outcome; it is recorded in the result so a reviewer reads WHY the branch is
# empty. Nothing else is ever declared here.
EMPTY_DECLARED=""
EV_DIR="$(task_evidence_dir 2>/dev/null || printf '')"
if [ -n "$EV_DIR" ]; then
  if [ -f "$EV_DIR/DELIVERED" ]; then
    EMPTY_DECLARED="this run recorded DELIVERED: the fix landed on another branch, so this branch carries no change set to scan"
  elif [ -f "$EV_DIR/VERIFICATION" ]; then
    EMPTY_DECLARED="this run recorded VERIFICATION: it verified an existing revision and was never asked to change source"
  fi
fi

printf '=== security stage ===\n'
printf 'base           %s\n' "${BASE_SHA:-<unresolved>}"
printf 'head           %s\n' "${HEAD_SHA:-<unresolved>}"
[ -n "$EMPTY_DECLARED" ] && printf 'empty declared %s\n' "$EMPTY_DECLARED"
if [ -z "$OUT" ]; then
  printf 'record         NOT RECORDED — no gate attempt is running and no --out was given.\n'
  printf '               The seal refuses an attempt with no security result, so this run\n'
  printf '               is a report, not evidence.\n'
fi

args=(--cwd "$TASK_CWD" --head "${HEAD_SHA:-}")
[ -n "$BASE_SHA" ] && args+=(--base "$BASE_SHA")
[ -n "$OUT" ] && args+=(--out "$OUT")
[ -n "$EMPTY_DECLARED" ] && args+=(--empty-declared "$EMPTY_DECLARED")

node "$SCRIPT_DIR/lib/security-scan.mjs" "${args[@]}"
rc=$?
if [ "$rc" -ne 0 ]; then
  printf '\nSECURITY STAGE REFUSED. Fix the findings above, or — when the stage could not read its\n' >&2
  printf 'input — resolve that first. Never lower the rule to get past it, and never mark a real\n' >&2
  printf 'finding with the per-line allow marker.\n' >&2
fi
exit "$rc"
