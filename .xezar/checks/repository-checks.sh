#!/usr/bin/env bash
# Fast checks against the actual repository, run as the last gate command.
#
# Each check below is SKIPPED, loudly, when the thing it inspects is not part of this project.
# That matters because this file is vendored into projects that do not all carry a changelog, a
# link checker or a contract test. Under `set -e` an unconditional call to a missing file aborts
# the whole gate on the first one, and every check after it silently never runs - which reads as
# "the gate passed" to anyone watching the exit code.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

skip() { printf 'repository-checks: skipped %s (%s)\n' "$1" "$2"; }

# The `.local/xezar/` working area keeps its six named subfolders and nothing loose at the top.
bash "$SCRIPT_DIR/local-tree.sh"

node "$SCRIPT_DIR/catalog-check.mjs" "$REPO_ROOT"

# The routing file is checked as the working tree holds it, so a pull request that breaks it fails.
if [ -f "$REPO_ROOT/.xezar/routing.json" ]; then
  node "$SCRIPT_DIR/route.mjs" --check "$REPO_ROOT/.xezar/routing.json"
else
  skip route-check "no .xezar/routing.json in this project"
fi

# The ad-hoc browser's MCP entry changes only through a security review, never through this gate.
bash "$SCRIPT_DIR/config-guard.sh" browser --from-base

# `--diff-base auto` refuses a direct `# Unreleased` edit: inside the gate run it resolves the
# attempt's own base; run bare it falls back to the remote default branch then the local one, and
# says so when neither exists. `--fragments` parses the per-pull-request changelog fragments.
# The fragment flow needs BOTH the changelog and a `changelog.d/` folder. A project that edits its
# changelog directly has no fragments to check, so the check is skipped, loudly, until the owner
# adopts fragments (create `changelog.d/` to turn it on).
if [ -f "$REPO_ROOT/CHANGELOG.md" ] && [ ! -d "$REPO_ROOT/changelog.d" ]; then
  skip changelog-check "CHANGELOG.md exists but this project has no changelog.d/ fragment folder"
elif [ -f "$REPO_ROOT/CHANGELOG.md" ]; then
  bash "$SCRIPT_DIR/changelog-check.sh" --file "$REPO_ROOT/CHANGELOG.md" --diff-base auto \
    --fragments "$REPO_ROOT/changelog.d"
else
  skip changelog-check "no CHANGELOG.md in this project"
fi

# Marked fenced quotes are exact copies of maintained repository files. A missing source is a
# failure, not a skip: a document can otherwise keep quoting a file from a different branch.
node "$SCRIPT_DIR/fenced-quotes.mjs" "$REPO_ROOT"

# Documented JSON keys are verified only by fixed scripts named in the reviewed allowlist; marker
# text can never select a path or command to execute. This is also where the leader-context
# loader's own fixture case runs - it is built in here, not shipped as a separate test file.
node "$SCRIPT_DIR/documented-output.mjs" "$REPO_ROOT"

# Offline relative-link and anchor check. Present only where the project keeps its own copy.
if [ -f "$REPO_ROOT/scripts/check-links.mjs" ]; then
  node "$REPO_ROOT/scripts/check-links.mjs"
else
  skip check-links "no scripts/check-links.mjs in this project"
fi

if [ -f "$SCRIPT_DIR/xezar-contract.test.mjs" ]; then
  node --test "$SCRIPT_DIR/xezar-contract.test.mjs"
else
  skip xezar-contract "no contract test installed beside these checks"
fi
if [ -f "$SCRIPT_DIR/lib/gate-parallel.test.mjs" ]; then
  node --test "$SCRIPT_DIR/lib/gate-parallel.test.mjs"
else
  skip gate-parallel "no scheduler test installed beside these checks"
fi
