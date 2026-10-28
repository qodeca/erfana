#!/usr/bin/env bash
# Make a fresh Xezar task worktree usable, and record what the task is working on.
#
# Xezar checks out tracked files and nothing else: a new worktree has no node_modules,
# no dist, no coverage. The project config schema (the engine's `configSchema`)
# has no `setup` / `postCreate` key and the migration compatibility record is explicit
# that no setup hook may be invented, so a check step is the supported way to bootstrap.
# Check steps run in the same cwd as the agent steps, i.e. the worktree
# (`src/workflows/run.ts`, `spawn('bash', ['-lc', command], { cwd: state.cwd,
# env: process.env })`).
#
# It must be a FIRST step, never a last one: a workflow whose last step is a `command:`
# step is not interactive, which would silence XEZ:ASK and XEZ:DONE for the whole run
# (`src/workflows/run.ts` — `interactive = i === lastAgentIdx && i === workflow.steps.length - 1`).
#
# Idempotent by construction. `onFail.retry` jumps back to the named earlier step
# (`src/workflows/run.ts`, `step.onFail.retry`), so a gate failure that loops back to the
# implementation step does NOT re-run this one. Everything here must therefore be safe to
# skip on the second pass, and anything that can go stale during the run — the installed
# dependencies — is re-checked by the gates instead.
#
# Usage:
#   worktree-setup.sh                  setup for a writing workflow (isolation required)
#   worktree-setup.sh --allow-root     setup for a read-only workflow, which may run in the
#                                      primary checkout
#   worktree-setup.sh --readonly-init  evidence directory ONLY: no install, no toolchain
#                                      requirement beyond node, no base fetch. For a read-only
#                                      workflow that needs somewhere to write its findings
#   worktree-setup.sh --help           print the supported flags and exit 0
#
# WHY --readonly-init EXISTS. A review, a triage or a business analysis needs an evidence
# directory and nothing else. Making it pay for `npm ci` — minutes of
# work, and a node_modules tree it will never open — to get a manifest file was a cost with no
# purpose. It also invited the opposite mistake: a reviewer that wanted to RUN something
# installing into the author's worktree. Neither is offered here. A read-only run that genuinely
# needs to execute code gets its own prepared isolated checkout; it does not install into a tree
# it does not own.
#
# IDENTITY IS REQUIRED, AND IS NEVER GUESSED. In the primary checkout there is no worktree path
# to derive a run id from, so the id can only come from XEZ_TASK_ID. When neither is available
# this reports UNAVAILABLE and exits 3. It does not fall back to the root directory's basename:
# that would send one project's evidence into a directory named after a checkout, where two
# different runs would then overwrite each other.
#
# It never copies a .env, a credential file or any personal configuration into the
# worktree. Xezar seeds only the agent's own ignored config layer
# (`src/agent-config/seed.ts` — `seedAgentConfigLocalLayer`) and that is the ceiling.
#
# It relies on no Xezar environment variable: a check step is spawned with the manager
# process's `process.env`, which carries no XEZ_TASK_ID. See lib/common.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

usage() {
  printf 'usage: worktree-setup.sh [--allow-root | --readonly-init | --help]\n\n'
  printf '  (no flag)        full setup for a writing workflow: toolchain, base freshness,\n'
  printf '                   npm ci, manifest\n'
  printf '  --allow-root     the same, but the primary checkout is accepted (read-only workflow)\n'
  printf '  --readonly-init  evidence directory and manifest ONLY. No install, no base fetch.\n'
  printf '                   Exits 3 when the run id cannot be resolved; it never guesses one\n'
  printf '  --help           this text\n'
}

ALLOW_ROOT=""
READONLY_INIT=0
case "${1:-}" in
  "") ;;
  --help | -h)
    usage
    exit 0
    ;;
  --allow-root) ALLOW_ROOT="--allow-root" ;;
  --readonly-init)
    ALLOW_ROOT="--allow-root"
    READONLY_INIT=1
    ;;
  *)
    printf 'worktree-setup: unknown argument "%s". Supported: --allow-root | --readonly-init | --help\n' "$1" >&2
    printf '\n' >&2
    usage >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  shift
  printf 'worktree-setup: takes exactly one flag (extra arguments: %s)\n' "$*" >&2
  exit 2
fi

# Setup never re-implements the isolation rules; it refuses to run unless the preflight
# that owns them passed.
if ! "$SCRIPT_DIR/worktree-preflight.sh" $ALLOW_ROOT; then
  printf '\nSETUP ABORTED: the preflight failed. Nothing was installed or written.\n' >&2
  exit 1
fi

resolve_task_paths || exit 1
cd "$TASK_CWD" || exit 1

fatal() { printf 'SETUP FAILED: %s\n' "$*" >&2; exit 1; }

# --- Read-only evidence initialization ---------------------------------------------------
if [ "$READONLY_INIT" -eq 1 ]; then
  printf '\n=== evidence init (read-only) ===\n'
  command -v node >/dev/null 2>&1 || fatal "node is not on PATH, and the manifest is JSON"

  if [ -z "${TASK_ID:-}" ]; then
    printf '  identity      UNAVAILABLE\n'
    printf '\nEVIDENCE INIT UNAVAILABLE\n' >&2
    printf 'This run has no resolvable id: the checkout is not %s/<runId>, and XEZ_TASK_ID is\n' "$WORKTREES_DIR" >&2
    printf 'not set (a workflow `command:` step is spawned with the manager process environment,\n' >&2
    printf 'which does not carry it — see lib/common.sh).\n\n' >&2
    printf 'No directory was created. A run id is NOT guessed from the checkout'"'"'s basename: the\n' >&2
    printf 'evidence root is keyed by run, and a name derived from a path would collect every run\n' >&2
    printf 'in that checkout into one directory, each overwriting the last.\n' >&2
    printf 'Run this as an agent step, where XEZ_TASK_ID exists, or report the evidence location as\n' >&2
    printf 'unavailable and record findings in the task itself.\n' >&2
    exit 3
  fi

  manifest="$(task_manifest_path)"
  node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --init \
    "runId=${TASK_ID}" \
    "cwd=${TASK_CWD}" \
    "isWorktree=${IS_WORKTREE}" \
    "branch=${BRANCH}" \
    "headSha=${HEAD_SHA}" || fatal "could not write the task manifest"

  printf '  run           %s (%s)\n' "$TASK_ID" "$TASK_ID_SOURCE"
  printf '  evidence      %s\n' "$(task_evidence_dir)"
  printf '  manifest      %s\n' "$manifest"
  printf '  deps          NOT installed — this mode never installs anything\n'
  printf '\nEVIDENCE INIT OK\n'
  printf '  This checkout has no node_modules unless something else put them there, so no repository\n'
  printf '  command is expected to run here. That is a READINESS statement, not a claim that a\n'
  printf '  reviewer may never execute anything: work that needs execution gets its own prepared\n'
  printf '  isolated checkout. It is never installed into a checkout this run does not own.\n'
  exit 0
fi

printf '\n=== worktree setup ===\n'

# --- Toolchain ----------------------------------------------------------------------
# The repo requires Node >= 20 and pins npm through `packageManager`. A worktree
# inherits the shell's PATH, so this catches a cockpit started under the wrong Node.
# With `dependencies.units` (lib/deps.mjs) each unit's tool is checked instead — npm, Yarn 1,
# the .NET SDK — and a numeric root .nvmrc pins the Node major (lib/common.sh applied it).
command -v node >/dev/null 2>&1 || fatal "node is not on PATH"
deps_units_mode
DEPS_UNITS=$?
[ "$DEPS_UNITS" -ne 2 ] || fatal "dependencies.units was refused (reason above); nothing was installed"

if [ "$DEPS_UNITS" -eq 0 ]; then
  node "$SCRIPT_DIR/lib/deps.mjs" tools --root "$TASK_CWD" || fatal "a dependency unit's toolchain is not usable here (reason above)"
else
  command -v npm >/dev/null 2>&1 || fatal "npm is not on PATH"

  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 20) {
      console.error(`node ${process.versions.node} is below the required 20`);
      process.exit(1);
    }
  ' || fatal "unsupported Node version"

  printf '  node          %s\n' "$(node --version)"
  printf '  npm          %s\n' "$(npm --version)"
fi

# --- Base freshness ------------------------------------------------------------------
# Xezar resolves the fork point without fetching — "agents fetch, they never pull"
# (the engine's `createWorktree`) — so the worktree is only as current as the
# primary checkout's origin ref was at creation time. Report the gap; never rewrite
# history to close it. Rebasing is a human decision.
if git fetch --quiet origin "$BASE_BRANCH" 2>/dev/null; then
  behind="$(git rev-list --count "HEAD..origin/$BASE_BRANCH" 2>/dev/null || printf '?')"
  if [ "$behind" = "0" ]; then
    printf '  base          up to date with origin/%s\n' "$BASE_BRANCH"
  else
    printf '  base          %s commit(s) behind origin/%s — report this, do not rebase\n' \
      "$behind" "$BASE_BRANCH"
  fi
else
  printf '  base          could not fetch origin/%s (offline?) — fork point freshness unknown\n' \
    "$BASE_BRANCH"
fi

# --- Dependencies ---------------------------------------------------------------------
# In units mode the install is deps-restore.sh: the same script the gates run first, so setup
# and the gates can never install two different sets.
if deps_are_fresh; then
  if [ "$DEPS_UNITS" -eq 0 ]; then
    printf '  deps          already current for every unit in dependencies.units — install skipped\n'
  else
    printf '  deps          already current for this lockfile — install skipped\n'
  fi
elif [ "$DEPS_UNITS" -eq 0 ]; then
  "$SCRIPT_DIR/deps-restore.sh" || fatal "the dependency install failed (deps-restore.sh)"
  deps_resolve_in_task || fatal "the install left dependencies missing or resolving outside this task"
  write_deps_stamp || fatal "could not write the dependency stamps"
  printf '  deps          installed\n'
else
  printf '  deps          installing (npm ci)\n'
  npm ci || fatal "npm ci failed"
  # Before the stamp: a tree whose workspace packages load from the primary checkout is not
  # current, and a stamp would tell the gates' --fast path it is (#286).
  deps_resolve_in_task || fatal "the install left workspace packages resolving outside this task"
  write_deps_stamp || fatal "could not write the dependency stamp"
  printf '  deps          installed\n'
fi

# --- Manifest ---------------------------------------------------------------------------
# The one channel that survives the worktree. Retention reclaims a finished worktree's
# DIRECTORY (keeping the xez/<id8> branch — `src/runs/retention.ts`, `reclaimWorktrees`), the startup
# orphan sweep removes both (`src/git-worktree.ts`, `pruneOrphans`), and the cockpit's Delete
# action removes the run, its worktree and its branch with no undo — so anything
# git-ignored written inside the worktree is destroyed without warning. The engine's own
# per-run scratch at `.local/xezar/scratch/<runId>` (`src/runs/agent-tmpdir.ts`) is reaped too.
# This lives in the primary checkout instead.
if [ -z "${TASK_ID:-}" ]; then
  printf '  manifest      SKIPPED: the run id could not be derived from the checkout path\n'
else
  manifest="$(task_manifest_path)"
  base_ref="origin/$BASE_BRANCH"
  git rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH" >/dev/null 2>&1 || base_ref="$BASE_BRANCH"
  base_sha="$(git merge-base HEAD "$base_ref" 2>/dev/null || printf '')"

  node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --init \
    "runId=${TASK_ID}" \
    "cwd=${TASK_CWD}" \
    "isWorktree=${IS_WORKTREE}" \
    "branch=${BRANCH}" \
    "baseRef=${base_ref}" \
    "baseSha=${base_sha}" \
    "headSha=${HEAD_SHA}" || fatal "could not write the task manifest"
  printf '  manifest      %s\n' "$manifest"
fi

# --- Summary -----------------------------------------------------------------------------
printf '\nSETUP OK\n'
printf '  work in       %s\n' "$TASK_CWD"
printf '  on branch     %s (Xezar owns it — do not rename or replace it)\n' "$BRANCH"
printf '  forked from   %s\n' "${base_ref:-$BASE_BRANCH}"
printf '  evidence to   %s/\n' "$(task_evidence_dir 2>/dev/null || printf '%s/.local/xezar/tasks/<no task id>' "$MAIN_ROOT")"
printf '  NOT to        %s/.local/xezar/ (destroyed with the worktree)\n' "$TASK_CWD"
exit 0
