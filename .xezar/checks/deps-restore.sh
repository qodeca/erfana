#!/usr/bin/env bash
# The one dependency install entry point.
#
# With `dependencies.units` in `.xezar/pipeline/config.json` (read from the base branch by
# lib/deps.mjs) it installs every unit, one after another: `npm ci`, Yarn 1 with
# `--frozen-lockfile --non-interactive`, or `dotnet restore <entry>`. It is then the first gate
# (`GATE_COMMANDS[0]` in repo-gates.sh and `validation.commands[0]`), and `worktree-setup.sh` runs
# it too, so setup and the gates install exactly the same set. Without the key it runs `npm ci` at
# the root, which is what a single-root project's first gate already does.
#
# It installs and nothing more: the caller proves the install is this task's own and writes the
# freshness stamps (repo-gates.sh, worktree-setup.sh). Exit 0 installed, 1 failed or refused.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

resolve_task_paths || { printf 'deps-restore: cannot resolve this checkout\n' >&2; exit 1; }
cd "$TASK_CWD" || exit 1

deps_units_mode
case $? in
  0) node "$DEPS_MJS" install --root "$TASK_CWD" || exit 1 ;;
  1) npm ci || exit 1 ;;
  *) printf 'deps-restore: dependencies.units was refused (reason above); nothing was installed\n' >&2; exit 1 ;;
esac
