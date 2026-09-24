#!/usr/bin/env bash
# First workflow step: make this committed project kit available in a task worktree (reuse or refuse when Git already delivered it).
# Does not seed source code, personal config, runtime or credentials.
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec node "$KIT_DIR/checks/lib/bootstrap.mjs" "$KIT_DIR"
