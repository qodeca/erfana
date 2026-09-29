#!/usr/bin/env bash
# Shared path, identity and dependency helpers for the Xezar worktree checks.
#
# Sourced (never executed) by worktree-preflight.sh, worktree-setup.sh and
# repo-gates.sh so all three agree on where they are. Everything is derived at run
# time — no absolute path is ever hard-coded, because the main checkout may live
# anywhere.
#
# Exports, after `resolve_task_paths`:
#   MAIN_ROOT     absolute, symlink-resolved path of the PRIMARY checkout
#   TASK_CWD      absolute, symlink-resolved path of the checkout we are in
#   IS_WORKTREE   1 when TASK_CWD is a linked worktree, 0 when it is MAIN_ROOT
#   WORKTREES_DIR absolute path of Xezar's worktree parent directory
#   BRANCH        the checked-out branch, or the literal "HEAD" when detached
#   HEAD_SHA      full SHA of HEAD
#   BASE_BRANCH   .xezar/config.json -> baseBranch (falls back to "main" only
#                 when the key is absent; a malformed config is a hard failure)
#   TASK_ID       the run id, derived from the worktree directory name
#   TASK_ID_SOURCE  "worktree-path" | "env" | ""
#
# ENVIRONMENT WARNING — the reason TASK_ID is derived, not read.
# Xezar exports XEZ_TASK_ID only to the spawned AGENT (agent step environment,
# the engine's `RunManager.agentEnv`, alongside XEZ_HANDOFF_FILE and
# XEZ_TODOS_FILE). A workflow `command:` step is still spawned with the manager
# process's own environment (the engine's `runCheckStep`), which has no XEZ_TASK_ID.
# Every check step here must therefore work with XEZ_TASK_ID unset. The authoritative
# identity is the worktree directory name, because Xezar names it after the run id.
#
# Engine facts encoded here, read from `@qodeca/xezar` 0.10.1 and unchanged since. Named by the
# symbol rather than by a path, because a path into the engine's own repository is a pointer the
# reader of an onboarded project cannot follow:
#   - `worktreesDir`  worktrees directory = '.local/xezar/worktrees'
#   - `branchFor()`   = `xez/${runId.slice(0, 8)}`
#   - `configSchema`  the project config schema, read from .xezar/config.json
# There is no XEZ_RUN_ID. Do not invent one.
#
# Source references name files and nearby symbols rather than unstable line numbers.
# These are code observations, not records of a live run: the actual Xezar lifecycle
# is qualified separately in this project's own installation records.

# Xezar's worktree parent, relative to the primary checkout.
XEZAR_WORKTREES_RELDIR=".local/xezar/worktrees"

# Absolute, symlink-resolved form of a directory. Comparing two paths that reach the
# same directory through different symlinks is the whole reason this exists.
abs_real_dir() {
  ( cd "$1" 2>/dev/null && pwd -P ) || return 1
}

# A task id becomes a directory name under the task evidence root. Anything that is not a
# single safe path segment is refused outright rather than sanitised, so a crafted id
# can never escape the evidence root.
valid_task_id() {
  local id="$1"
  [ -n "$id" ] || return 1
  [ "$id" != "." ] && [ "$id" != ".." ] || return 1
  case "$id" in
    */* | *\\* | *:*) return 1 ;;
  esac
  printf '%s' "$id" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
}

# The branch Xezar creates for a run: `xez/` plus the first 8 characters of the run id.
# Matching the *syntax* `xez/[0-9a-f]{8}` is not enough — a stale or hand-made xez branch
# from a different run has valid syntax and would pass. The branch must belong to THIS
# worktree.
#
# The legacy `cez/` prefix is deliberately NOT accepted here. Xezar restores `xez/<id8>`
# and nothing else (`src/runs/retention.ts`, `rematerializeReclaimedWorktree`, re-creates the worktree and reattaches
# `xez/<id8>`), so a worktree sitting on a Cezar-era branch would lose that work on
# reclaim; and accepting both prefixes would make the guard the one place where the
# migration is only half done. Historical `cez/*` branches stay in the repository,
# untouched and unrenamed — they are just not something a Xezar run may check out.
expected_task_branch() {
  [ -n "${TASK_ID:-}" ] || return 1
  printf 'xez/%s' "$(printf '%s' "$TASK_ID" | cut -c1-8)"
}

resolve_task_paths() {
  local toplevel common_dir
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  TASK_CWD="$(abs_real_dir "$toplevel")" || return 1

  # In the primary checkout `--git-common-dir` is relative (".git"); in a linked
  # worktree it is the absolute path of the primary checkout's .git directory.
  common_dir="$(cd "$TASK_CWD" && git rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common_dir" in
    /*) ;;
    *) common_dir="$TASK_CWD/$common_dir" ;;
  esac
  MAIN_ROOT="$(abs_real_dir "$(dirname "$common_dir")")" || return 1

  WORKTREES_DIR="$MAIN_ROOT/$XEZAR_WORKTREES_RELDIR"

  if [ "$TASK_CWD" = "$MAIN_ROOT" ]; then IS_WORKTREE=0; else IS_WORKTREE=1; fi

  BRANCH="$(cd "$TASK_CWD" && git rev-parse --abbrev-ref HEAD 2>/dev/null)" || BRANCH="HEAD"
  HEAD_SHA="$(cd "$TASK_CWD" && git rev-parse HEAD 2>/dev/null)" || HEAD_SHA=""

  BASE_BRANCH="$(xezar_base_branch)" || return 1

  resolve_task_id

  export MAIN_ROOT TASK_CWD IS_WORKTREE WORKTREES_DIR BRANCH HEAD_SHA BASE_BRANCH \
    TASK_ID TASK_ID_SOURCE
}

# Identity, derived first and read from the environment only as a fallback. When both are
# available they must agree: a mismatch means the run is not the run the environment
# claims, and guessing which one is right is not an option.
resolve_task_id() {
  TASK_ID=""
  TASK_ID_SOURCE=""
  TASK_ID_CONFLICT=""

  local from_path=""
  case "$TASK_CWD" in
    "$WORKTREES_DIR"/*)
      from_path="${TASK_CWD#"$WORKTREES_DIR"/}"
      case "$from_path" in */*) from_path="" ;; esac
      ;;
  esac

  local from_env="${XEZ_TASK_ID:-}"
  valid_task_id "$from_env" || from_env=""

  if [ -n "$from_path" ] && valid_task_id "$from_path"; then
    TASK_ID="$from_path"
    TASK_ID_SOURCE="worktree-path"
    if [ -n "$from_env" ] && [ "$from_env" != "$from_path" ]; then
      TASK_ID_CONFLICT="XEZ_TASK_ID=$from_env does not match the worktree directory $from_path"
    fi
  elif [ -n "$from_env" ]; then
    TASK_ID="$from_env"
    TASK_ID_SOURCE="env"
  fi
  export TASK_ID_CONFLICT
}

# An absent or present and BLANK baseBranch uses discovery.
# Match Xezar's discovered base in an unconfigured checkout. Explicit invalid JSON is refused.
xezar_base_branch() {
  local cfg="$TASK_CWD/.xezar/config.json" selected
  if [ -r "$cfg" ]; then
    selected="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(c.baseBranch!=null && typeof c.baseBranch!=="string")process.exit(1); process.stdout.write(c.baseBranch?.trim()??"")' "$cfg" 2>/dev/null)" || {
      printf 'xezar_base_branch: %s is not valid JSON/config\n' "$cfg" >&2; return 1;
    }
    if [ -n "$selected" ]; then printf '%s' "$selected"; return; fi
  fi
  selected="$(git -C "$TASK_CWD" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)" || selected=""
  if [ -n "$selected" ]; then printf '%s' "${selected#origin/}"; return; fi
  for selected in main master; do
    if git -C "$TASK_CWD" show-ref --verify --quiet "refs/heads/$selected"; then printf '%s' "$selected"; return; fi
  done
  printf 'main'
}

# A list of strings from `.xezar/pipeline/config.json`, one per line, for a dotted key such as
# `ci.requiredChecks`. Absent, empty or not an array gives an empty list and exit 0 — a project
# that has not stated its CI job names has none, which is a fact rather than a fault. Malformed
# JSON is refused, because a config nobody can parse is not a config with no entries. Every
# project-specific name a check needs comes through here: a list baked into a script is a fact
# about one repository shipped to every other one.
pipeline_config_list() {
  local key="${1:-}" cfg="$TASK_CWD/.xezar/pipeline/config.json"
  [ -n "$key" ] || return 1
  [ -r "$cfg" ] || return 0
  node -e '
    const [file, key] = process.argv.slice(1);
    const cfg = JSON.parse(require("fs").readFileSync(file, "utf8"));
    let node = cfg;
    for (const part of key.split(".")) node = node?.[part];
    if (node == null) process.exit(0);
    if (!Array.isArray(node)) process.exit(0);
    for (const v of node) if (typeof v === "string" && v.trim() !== "") process.stdout.write(`${v}\n`);
  ' "$cfg" "$key" 2>/dev/null || {
    printf 'pipeline_config_list: %s is not valid JSON\n' "$cfg" >&2; return 1;
  }
}

# The per-task evidence directory in the PRIMARY checkout. Worktree-local .local/xezar/ is
# destroyed by retention, the orphan sweep and the cockpit's Delete action, so nothing
# that must outlive the run may be written there.
#
# The engine also hands each run its own scratch directory at `.local/xezar/scratch/<runId>`
# and reaps it at run end (src/runs/agent-tmpdir.ts). That is engine-owned state, not an
# evidence location: anything that must survive the run still belongs here.
# TWO ROOTS, AND NOTHING EVER MOVES BETWEEN THEM. `.local/xezar-tasks` is the frozen historical
# root; `.local/xezar/tasks` is where new evidence goes. A sealed manifest stores ABSOLUTE paths
# and gate-results.mjs asserts the manifest sits at its canonical location, so bulk-moving old
# evidence would invalidate every historical seal — which is why this is a resolve rather than a
# rename. A run that already has a directory under the old root keeps writing there for its whole
# life, which is exactly what the counter and seal rules need; everything else lands in the new
# root, including a checkout that has neither. The readers (gate-results.mjs, verify-evidence.sh,
# phase-record.sh) accept both roots for as long as this window lasts.
task_evidence_dir() {
  [ -n "${TASK_ID:-}" ] || return 1
  task_evidence_dir_of "$TASK_ID"
}

# The same resolution for ANOTHER run's evidence — a predecessor's counters, an audited run. Read
# side only: nothing this returns for a foreign id may be written to.
task_evidence_dir_of() {
  local id="${1:-}" new old
  [ -n "$id" ] || return 1
  new="$MAIN_ROOT/.local/xezar/tasks/$id"
  old="$MAIN_ROOT/.local/xezar-tasks/$id"
  if [ ! -d "$new" ] && [ -d "$old" ]; then printf '%s' "$old"; return; fi
  printf '%s' "$new"
}

# Both evidence roots, new first. A reader that scans one of them and reports "nothing found"
# while runs exist under the other is the silent half-state this window has to prevent, so every
# scan walks this list rather than a literal.
task_evidence_roots() {
  printf '%s/.local/xezar/tasks\n%s/.local/xezar-tasks\n' "$MAIN_ROOT" "$MAIN_ROOT"
}

task_manifest_path() {
  local dir
  dir="$(task_evidence_dir)" || return 1
  printf '%s/manifest.json' "$dir"
}

# Where gate attempts and their logs live. One directory per head SHA, one per attempt beneath
# it, so a second attempt on the same revision can never overwrite the first — and an
# interrupted attempt stays on disk as the visible fact that it was interrupted.
task_gates_dir() {
  local dir
  dir="$(task_evidence_dir)" || return 1
  printf '%s/gates' "$dir"
}

# Where a gate run with NO engine run id puts its output — the owner running the gates by hand,
# and the second tier of an onboarding smoke test, both of which happen in the primary checkout
# before any task exists. It is deliberately NOT under an evidence root: `gate-results.mjs`
# derives the run id from the directory a manifest sits in and refuses anything outside this
# repository's canonical evidence paths, so a hand run yields a real verdict and can never be
# sealed, certified, or mistaken for somebody's merge evidence. `scratch` is one of the six
# allowed `.local/xezar/` subfolders, so nothing here disturbs the tidiness check.
standalone_gates_dir() {
  printf '%s/.local/xezar/scratch/standalone-gates' "$MAIN_ROOT"
}

# Repository identity that works offline and leaks nothing.
#
# The root commit is the stable, fetch-free answer to "is this the same repository". The origin
# URL is recorded only as host+path: an HTTPS remote can carry a token in its userinfo
# (`https://x-access-token:<TOKEN>@github.com/...`), and evidence files are read by people and
# pasted into reports.
repo_identity() {
  local root_commit origin
  root_commit="$(cd "$TASK_CWD" && git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)"
  origin="$(cd "$TASK_CWD" && git config --get remote.origin.url 2>/dev/null)"
  # Strip any scheme and userinfo, leaving host/path.
  origin="${origin#*://}"
  origin="${origin##*@}"
  node -e '
    process.stdout.write(JSON.stringify({ rootCommit: process.argv[1] || null, origin: process.argv[2] || null }));
  ' "$root_commit" "$origin"
}

# The toolchain the gates actually ran on. Versions only — never an environment dump, which
# would put tokens and personal paths into a file that gets read out loud in reviews.
env_profile() {
  # In units mode the unit tools' versions (yarn, dotnet) are added; a single npm root records
  # exactly what it always did.
  local unit_tools="{}"
  if deps_units_mode 2>/dev/null; then unit_tools="$(node "$DEPS_MJS" versions --root "$TASK_CWD" 2>/dev/null)" || unit_tools="{}"; fi
  # BASH_VERSION is a shell variable, not an environment one, so it has to be handed over
  # explicitly — reading it from `process.env` silently records null.
  BASH_VERSION="${BASH_VERSION:-}" node -e '
    const { execFileSync } = require("node:child_process");
    const os = require("node:os");
    const version = (cmd, ...args) => {
      try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]; }
      catch { return null; }
    };
    process.stdout.write(JSON.stringify({
      platform: os.platform(),
      arch: os.arch(),
      node: process.versions.node,
      npm: version("npm", "--version"),
      git: version("git", "--version"),
      bash: process.env.BASH_VERSION ?? null,
      ...JSON.parse(process.argv[1] || "{}"),
    }));
  ' "$unit_tools"
}

# The SHA of the tree HEAD points at. The commit binds the history; the tree binds the content,
# and it is what a verifier can re-derive from the commit long after the worktree is gone.
head_tree_sha() {
  ( cd "$TASK_CWD" && git rev-parse "HEAD^{tree}" 2>/dev/null ) || printf ''
}

# Is anything uncommitted? Final certification is about a committed revision: uncommitted work
# is not on the branch, so it is not in the pull request either.
task_tree_is_dirty() {
  [ -n "$( cd "$TASK_CWD" && git status --porcelain 2>/dev/null )" ]
}

# This checkout's own .git directory, absolute. In a linked worktree that is
# <primary>/.git/worktrees/<leaf>, not the primary .git — which is exactly what the
# in-progress-operation markers hang off.
task_git_dir() {
  local git_dir
  git_dir="$(cd "$TASK_CWD" && git rev-parse --git-dir 2>/dev/null)" || return 1
  case "$git_dir" in
    /*) ;;
    *) git_dir="$TASK_CWD/$git_dir" ;;
  esac
  printf '%s' "$git_dir"
}

# EVERY in-progress git operation this checkout is in the middle of, one per line.
#
# `unresolved_git_operation` answers "is there one" and stops at the first. The recovery path
# needs the whole set instead: admitting a merge means proving that a merge is the ONLY thing in
# flight, and a first-match probe cannot tell "a merge" from "a merge and a rebase".
git_operations_in_progress() {
  local git_dir marker
  git_dir="$(task_git_dir)" || return 0
  for marker in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    [ -e "$git_dir/$marker" ] && printf '%s\n' "$marker"
  done
  for marker in rebase-merge rebase-apply; do
    [ -d "$git_dir/$marker" ] && printf '%s\n' "$marker"
  done
  if unmerged_paths_present; then printf 'unmerged paths\n'; fi
  return 0
}

# Are there conflicted (unmerged) index entries? `git diff --diff-filter=U` asks the index
# directly, which is what a commit will refuse on, rather than parsing status letters.
unmerged_paths_present() {
  [ -n "$( cd "$TASK_CWD" && git diff --name-only --diff-filter=U 2>/dev/null )" ]
}

# Is the checkout in the middle of a git operation nobody resolved? A half-finished
# merge is the exact state the cockpit's autosave refuses to commit, so a check that
# ignores it would hand the next step a tree that cannot be trusted.
unresolved_git_operation() {
  local first
  first="$(git_operations_in_progress | head -1)"
  [ -n "$first" ] || return 1
  printf '%s' "$first"
}

# Where a run records that it is ABOUT to start an authorized merge. In the primary checkout,
# beside the run's other evidence, because the whole point is that it survives the interruption
# that made the recovery necessary — and a worktree-local file does not.
merge_intent_path() {
  local dir
  dir="$(task_evidence_dir)" || return 1
  printf '%s/merge-intent.json' "$dir"
}

# --- Fixture scratch ---------------------------------------------------------------------
#
# Throwaway repositories, clones and probe trees that a test or a check builds go HERE, under the
# primary checkout, and nowhere else:
#
#   - NOT /tmp: it is outside the repository, outside every retention rule, and its contents are
#     invisible to anyone auditing what a run did;
#   - NOT the worktree's own .local/xezar/: retention, the boot orphan sweep and the cockpit's Delete
#     action destroy that directory with no warning and no undo;
#   - NOT the engine's per-run scratch at .local/xezar/scratch/<runId>: it is reaped at run end, which
#     makes it fine for transient state and wrong for anything a human may need to look at.
#
# CLEANUP IS BEST EFFORT AND IS SAID TO BE. A normal exit removes the directory through the
# caller's trap. A SIGKILL runs no trap, so the directory stays — which is why every fixture root
# carries an OWNER file naming the run, the pid and the time: an orphan is then identifiable as
# an interrupted run's leftover rather than an unexplained directory nobody dares delete. Nothing
# here promises cleanup after SIGKILL, and no sweep deletes these automatically.
fixture_scratch_root() {
  printf '%s/.local/xezar/qa/tests' "$MAIN_ROOT"
}

# Claim one fixture directory, named by an id the caller owns. The id is validated as a single
# safe path segment before it is joined, so it can never escape the scratch root.
fixture_scratch_dir() {
  local id="$1"
  valid_task_id "$id" || {
    printf 'fixture_scratch_dir: "%s" is not a single safe path segment\n' "$id" >&2
    return 1
  }
  local dir
  dir="$(fixture_scratch_root)/$id"
  mkdir -p "$dir" || return 1
  printf 'owner   %s\nrunId   %s\npid     %s\nstarted %s\nnote    an interrupted run leaves this behind; cleanup is best effort, never guaranteed after SIGKILL\n' \
    "${2:-unnamed}" "${TASK_ID:-<none>}" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/OWNER"
  printf '%s' "$dir"
}

# Remove a fixture directory, but only one that is genuinely inside the scratch root.
#
# THE PROOF RUNS BEFORE THE DESTRUCTIVE OPERATION, AND IT CANONICALIZES BOTH SIDES.
#
# The first version compared the shell pattern `"$root"/?*`, which is a TEXT prefix test. `?*`
# happily matches `..`, so `"$root/../../VICTIM"` passed the check and was deleted — the one helper
# in this file that actually runs `rm -rf` was the one that skipped the isolation proof every other
# helper performs, while its comment claimed the opposite.
#
# The rule now: absolute, non-empty, not the scratch root itself, and — after resolving every
# symlink and `..` on both sides — genuinely underneath the canonical scratch root. Canonicalizing
# the ROOT too matters: comparing a canonical candidate against an uncanonical root fails whenever
# any parent of the checkout is a symlink, which on macOS is routine.
#
# OWNERSHIP BOUNDARY. This deletes only what this suite created under
# `<primary>/.local/xezar/qa/tests/`. It is not a general remover, it never touches a repository, a
# worktree registration or anything under a task evidence root, and it deliberately does NOT reuse
# `assert_isolated_fixture_root`: a scratch directory being removed need not be a git repository at
# all, so a repository assertion would be the wrong proof for this caller.
fixture_scratch_remove() {
  local dir="$1" root canon_root canon_dir

  if [ -z "$dir" ]; then
    printf 'fixture_scratch_remove: refusing an EMPTY path\n' >&2
    return 1
  fi
  case "$dir" in
    /*) ;;
    *)
      printf 'fixture_scratch_remove: refusing a RELATIVE path ("%s") — it resolves against the CWD\n' "$dir" >&2
      return 1
      ;;
  esac

  # A final segment of `.` or `..` names a DIRECTORY, not the thing the caller meant, and it is how
  # a path like `<root>/owned/..` reads as "inside the root" while pointing at its parent. `rm`
  # refuses these itself, but leaning on that is leaning on an external tool's behaviour inside the
  # one helper here that deletes — so it is refused before anything is resolved or removed.
  case "$(basename "$dir")" in
    . | ..)
      printf 'fixture_scratch_remove: refusing "%s" — its final segment is "%s", which names a directory rather than a target\n' \
        "$dir" "$(basename "$dir")" >&2
      return 1
      ;;
  esac

  root="$(fixture_scratch_root)"
  # The root may not exist yet, and that is not an error — there is simply nothing to remove.
  if ! canon_root="$(cd "$root" 2>/dev/null && pwd -P)"; then
    printf 'fixture_scratch_remove: the scratch root %s does not exist, so nothing there can be removed\n' "$root" >&2
    return 1
  fi
  # Resolve the candidate through its PARENT, so a path whose final segment is a symlink is judged
  # by where the link sits rather than by where it points — and so a candidate that no longer exists
  # can still be checked instead of silently passing.
  if ! canon_dir="$(cd "$(dirname "$dir")" 2>/dev/null && pwd -P)"; then
    printf 'fixture_scratch_remove: refusing "%s" — its parent directory cannot be resolved\n' "$dir" >&2
    return 1
  fi
  canon_dir="$canon_dir/$(basename "$dir")"
  # If the candidate itself exists and is a symlink, refuse: removing it is fine, but the prefix
  # test below would then be about the link and not about its target, which is not a proof.
  if [ -L "$canon_dir" ]; then
    printf 'fixture_scratch_remove: refusing "%s" — it is a symlink, and its target is not proved to be owned\n' "$dir" >&2
    return 1
  fi

  if [ "$canon_dir" = "$canon_root" ]; then
    printf 'fixture_scratch_remove: refusing to remove the scratch ROOT itself (%s) — it is shared by every run\n' "$canon_root" >&2
    return 1
  fi
  case "$canon_dir" in
    "$canon_root"/?*) ;;
    *)
      printf 'fixture_scratch_remove: refusing to remove "%s" — it resolves to %s, which is not under %s\n' \
        "$dir" "$canon_dir" "$canon_root" >&2
      return 1
      ;;
  esac

  # Proved. Removing something already gone is success, so cleanup is safe to run twice.
  rm -rf "$canon_dir"
}

# The install gate's name in the CURRENT canonical list (repo-gates.sh `GATE_NAMES[0]`), for
# `gate-results.mjs --install-gate`. Taken from the live list, never from a record being judged; an
# unreadable list gives an empty name, and then only the legacy "npm ci" skip is accepted.
install_gate_name() {
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/repo-gates.sh" --list --json 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      try { const name = JSON.parse(raw).gates[0].name; if (typeof name === "string") process.stdout.write(name); } catch {}
    });' 2>/dev/null
}

# --- Dependency units -----------------------------------------------------------------
#
# A repository with no single root manifest lists its installs in `dependencies.units` of
# `.xezar/pipeline/config.json`. `lib/deps.mjs` reads them from the BASE BRANCH, never this
# checkout, validates them, and owns everything about them: install, fingerprint, stamps and the
# own-install proof. Without the key every function below takes its single-npm-root path, and its
# output is what it always was.
DEPS_MJS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/deps.mjs"
DEPS_MODE_ROOT=""
DEPS_MODE=""

# 0 = units mode, 1 = a single npm root (the default), 2 = the units are refused (reason on
# stderr). A refusal is never cached, so the next caller prints the reason again.
deps_units_mode() {
  [ -n "${TASK_CWD:-}" ] || return 1
  if [ "$DEPS_MODE_ROOT" != "$TASK_CWD" ]; then
    DEPS_MODE="$(node "$DEPS_MJS" mode --root "$TASK_CWD")" || return 2
    DEPS_MODE_ROOT="$TASK_CWD"
  fi
  [ "$DEPS_MODE" = units ]
}

# Units mode only: a numeric root .nvmrc (`22`, `v22.3.0`) pins the Node major. When the `node` on
# PATH has another major, the newest installed `$NVM_DIR/versions/node/v<major>.*` goes first on
# PATH. Nothing is sourced and nothing is downloaded; with no such version installed PATH is left
# alone and `worktree-setup.sh` names the Node it found and the major it wanted. Applied HERE, as
# the file is sourced, so setup, the gates and the evidence steps all fingerprint the same Node.
deps_use_pinned_node() {
  local root bin
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd -P)" || return 0
  [ -f "$root/.nvmrc" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  bin="$(node "$DEPS_MJS" node-pin --root "$root" 2>/dev/null)" || return 0
  [ -n "$bin" ] || return 0
  PATH="$bin:$PATH"
  export PATH
}
deps_use_pinned_node

# --- Dependency freshness -----------------------------------------------------------
#
# A fresh Xezar worktree carries no node_modules: only tracked files are checked out, so
# every task installs its own. The gates may then skip that install with `--fast` — but
# only when the installed tree still matches what npm would resolve from. "node_modules
# exists" is a different, weaker question: an agent that edits the lockfile, a
# package.json, .npmrc or a patch mid-run leaves node_modules stale, and a `--fast` gate
# run would then judge the wrong tree and call it green.
#
# The fingerprint therefore covers every input npm actually resolves from: the lockfile,
# the workspace definition, the registry/hoisting configuration, the patch files applied
# through `npm.patchedDependencies`, the pinned package manager, and every workspace
# package.json.
deps_fingerprint() {
  deps_units_mode 2>/dev/null
  case $? in
    0) node "$DEPS_MJS" fingerprint --root "$TASK_CWD"; return ;;
    2) printf 'units-refused'; return 1 ;;
  esac
  (
    cd "$TASK_CWD" || return 1
    local f
    for f in package-lock.json npm-shrinkwrap.json package.json .npmrc; do
      [ -f "$f" ] && shasum -a 256 "$f"
    done
    # Patches are applied at install time, so a changed patch means a different node_modules.
    if [ -d patches ]; then
      find patches -type f -print 2>/dev/null | LC_ALL=C sort |
        while IFS= read -r f; do shasum -a 256 "$f"; done
    fi
    # Workspace manifests. `find` is given only the directories that exist, because a
    # missing `examples/` must not turn into a failed fingerprint under `set -o pipefail`.
    local roots=()
    [ -d packages ] && roots+=(packages)
    [ -d examples ] && roots+=(examples)
    if [ ${#roots[@]} -gt 0 ]; then
      find "${roots[@]}" -mindepth 2 -maxdepth 2 -name package.json -print 2>/dev/null |
        LC_ALL=C sort |
        while IFS= read -r f; do shasum -a 256 "$f"; done
    fi
    # The pinned package manager: a different npm resolves differently.
    node -e '
      const fs = require("node:fs");
      try {
        const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
        process.stdout.write(`packageManager=${pkg.packageManager ?? ""}\n`);
      } catch { process.stdout.write("packageManager=unreadable\n"); }
    ' 2>/dev/null
    printf 'npm=%s\n' "$(npm --version 2>/dev/null || printf 'unknown')"
    printf 'node=%s\n' "$(node --version 2>/dev/null || printf 'unknown')"
  ) | shasum -a 256 | cut -d' ' -f1
}

# Lives inside node_modules on purpose: wiping node_modules must also invalidate the
# claim that node_modules is current.
deps_stamp_path() {
  printf '%s/node_modules/.xezar-deps-stamp' "$TASK_CWD"
}

# 0 = the installed dependencies match the manifests; 1 = install (or re-install) needed.
# A stamp is not enough on its own: a tree whose workspace links were lost still carries it,
# and every import through a lost link resolves from the primary checkout (#286).
deps_are_fresh() {
  local stamp
  deps_units_mode 2>/dev/null
  case $? in
    0) node "$DEPS_MJS" fresh --root "$TASK_CWD" 2>/dev/null; return ;;
    2) return 1 ;;
  esac
  stamp="$(deps_stamp_path)"
  [ -f "$stamp" ] || return 1
  [ -d "$TASK_CWD/node_modules" ] || return 1
  [ "$(cat "$stamp" 2>/dev/null)" = "$(deps_fingerprint)" ] || return 1
  deps_resolve_in_task 2>/dev/null
}

# 0 = every workspace package the task declares resolves to the task's OWN copy.
#
# A task worktree lives INSIDE the primary checkout (`.local/xezar/worktrees/<runId>`), and
# node looks for a package in every ancestor's node_modules, nearest first. So when the task's
# own `node_modules/<name>` link is missing, the lookup does not fail — it walks on to the
# primary's node_modules, whose workspace link points at the PRIMARY's source (#286). A test,
# a typecheck or a build then judges code this branch does not contain, and reports it green.
# `npm ci` writes every link, so this only fails on a tree npm did not finish, or one something
# else damaged. It never installs or repairs anything: it names what is wrong and fails.
deps_resolve_in_task() {
  deps_units_mode
  case $? in
    0) node "$DEPS_MJS" resolve --root "$TASK_CWD"; return ;;
    2) return 1 ;;
  esac
  node -e '
    const fs = require("node:fs"), path = require("node:path");
    const root = fs.realpathSync(process.argv[1]);
    const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") process.exit(0); // no manifest: no workspaces to resolve
      console.error(`deps: cannot read ${path.join(root, "package.json")} (${e.message}), so which workspace packages this task resolves is unknown`);
      process.exit(1);
    }
    const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
    const dirs = [];
    for (const p of patterns) {
      if (p.endsWith("/*") && !/[*?[{]/.test(p.slice(0, -2))) {
        const parent = path.join(root, p.slice(0, -2));
        for (const e of fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }) : []) {
          if (e.isDirectory()) dirs.push(path.join(parent, e.name));
        }
      } else if (/[*?[{]/.test(p)) {
        console.error(`deps: workspace pattern "${p}" is not one this check can expand, so it cannot prove where it resolves`);
        process.exit(1);
      } else {
        dirs.push(path.join(root, p));
      }
    }
    const problems = [];
    for (const dir of dirs) {
      let name;
      try { name = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name; } catch { continue; }
      if (typeof name !== "string" || name === "") continue;
      const link = path.join(root, "node_modules", ...name.split("/"));
      const got = real(link), want = real(dir);
      if (got !== null && got === want) continue;
      if (got !== null) {
        problems.push(`  ${name}: ${link} -> ${got}, not this task'"'"'s ${want}`);
        continue;
      }
      let borrowed = null;
      for (let d = path.dirname(root); ; d = path.dirname(d)) {
        const candidate = path.join(d, "node_modules", ...name.split("/"));
        if (real(candidate) !== null) { borrowed = `${candidate} -> ${real(candidate)}`; break; }
        if (d === path.dirname(d)) break;
      }
      problems.push(`  ${name}: no link at ${link}; node resolves it from ${borrowed ?? "nowhere (it will not be found)"}`);
    }
    if (problems.length === 0) process.exit(0);
    console.error("DEPENDENCIES RESOLVE OUTSIDE THIS TASK (#286)");
    console.error(`These workspace packages would not load from ${root}:`);
    for (const p of problems) console.error(p);
    console.error("Anything run here now would judge another checkout'"'"'s source, not this branch.");
    console.error(`Reinstall in this checkout (npm ci in ${root}) before running any check.`);
    process.exit(1);
  ' "$TASK_CWD"
}

write_deps_stamp() {
  deps_units_mode 2>/dev/null
  case $? in
    0) node "$DEPS_MJS" stamp --root "$TASK_CWD"; return ;;
    2) return 1 ;;
  esac
  mkdir -p "$TASK_CWD/node_modules" || return 1
  deps_fingerprint > "$(deps_stamp_path)"
}

# --- Gate evidence --------------------------------------------------------------------
#
# A fingerprint of everything the gates just judged. It must cover file CONTENT, not just
# which files are dirty: `git status --porcelain` reports the same two lines whether an
# already-modified file was left alone or rewritten from scratch, so a name-and-status
# hash would happily certify a tree the gates never saw.
#
# Three parts, which together cover every non-ignored byte:
#   1. HEAD — binds the evidence to an exact commit;
#   2. `git diff HEAD` — every staged and unstaged change to tracked files, by content;
#   3. the content of every untracked, non-ignored file.
#
# It identifies a REVISION plus working changes. It is not an attestation that any
# command ran, nor that the environment that ran it still exists.
tree_fingerprint() {
  (
    cd "$TASK_CWD" || return 1
    printf 'head=%s\n' "$(git rev-parse HEAD 2>/dev/null || printf 'no-head')"
    printf -- '--kit--\n'
    for kit_part in checks skills workflows docs pipeline; do
      if [ -d ".xezar/$kit_part" ]; then
        find ".xezar/$kit_part" -type f -print | LC_ALL=C sort |
          while IFS= read -r kit_file; do shasum -a 256 "$kit_file"; done
      fi
    done
    for kit_file in config.json CLAUDE.md kit-manifest.json .gitignore; do
      [ ! -f ".xezar/$kit_file" ] || shasum -a 256 ".xezar/$kit_file"
    done
    printf -- '--tracked--\n'
    git diff HEAD 2>/dev/null
    printf -- '--untracked--\n'
    git ls-files --others --exclude-standard -z 2>/dev/null |
      LC_ALL=C sort -z |
      while IFS= read -r -d '' f; do
        if [ -f "$f" ] && [ ! -L "$f" ]; then
          printf '%s ' "$f"
          shasum -a 256 "$f" | cut -d' ' -f1
        else
          # A symlink or a special file: record its kind and target, never follow it.
          printf '%s special %s\n' "$f" "$(readlink "$f" 2>/dev/null || printf 'non-regular')"
        fi
      done
  ) | shasum -a 256 | cut -d' ' -f1
}
