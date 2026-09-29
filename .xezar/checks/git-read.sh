#!/usr/bin/env bash
# The only way a reading role runs git.
#
# A reading step (no Edit, no Write in its `allowedTools`) carries a `bashAllowlist`, and the engine
# turns each entry into a command prefix. A prefix cannot say "but not this flag": `git diff`,
# `git log` and `git show` all accept `--output=<file>`, which writes wherever it is pointed. So a
# reading step is not allowed `git` at all; it is allowed this script, which runs one of a fixed set
# of reading subcommands and refuses every argument that makes git write or run a helper.
#
# Usage:
#   git-read.sh <subcommand> [<args>…]
#
#   <subcommand> is one of: diff | log | show | rev-parse | status | merge-base | ls-files |
#                           cat-file | blame | describe
#
# Exit: git's own status on a run, 1 on a refused argument, 2 on usage.
set -uo pipefail

usage() {
  echo "usage: git-read.sh <diff|log|show|rev-parse|status|merge-base|ls-files|cat-file|blame|describe> [<args>…]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
sub="$1"
shift

case "$sub" in
  diff | log | show | rev-parse | status | merge-base | ls-files | cat-file | blame | describe) ;;
  *)
    echo "git-read.sh: refused: \"$sub\" is not a reading subcommand this script runs" >&2
    exit 1
    ;;
esac

# Each of these makes git write a file, run a program the repository configures, or read a file
# outside the repository. git accepts any unambiguous abbreviation of a long option (`--outp`,
# `--textc`), so a long option is refused when it is a prefix of one of these as well as when it
# is the whole name.
BLOCKED_LONG="output ext-diff textconv exec upload-pack receive-pack git-dir work-tree filters no-index contents config-env"
for arg in "$@"; do
  refused=""
  case "$arg" in
    --*)
      name="${arg#--}"
      name="${name%%=*}"
      if [ "${#name}" -ge 3 ]; then
        for blocked in $BLOCKED_LONG; do
          case "$blocked" in "$name"*) refused=1 ;; esac
        done
      fi
      ;;
    -O*)
      # `-O <file>` reads an order file from anywhere. (`-c` here is not git's config switch: that
      # one goes before the subcommand, which this script always places first.)
      refused=1
      ;;
  esac
  if [ -n "$refused" ]; then
    echo "git-read.sh: refused: \"$arg\" can make git write, run a helper or read outside the repository" >&2
    exit 1
  fi
done

# No optional lock: `status` and `describe --dirty` would otherwise rewrite the index file.
export GIT_OPTIONAL_LOCKS=0
case "$sub" in
  diff | log | show) exec git --no-pager "$sub" --no-ext-diff --no-textconv "$@" ;;
  blame) exec git --no-pager blame --no-textconv "$@" ;;
  status) exec git --no-pager status --no-renames "$@" ;;
  *) exec git --no-pager "$sub" "$@" ;;
esac
