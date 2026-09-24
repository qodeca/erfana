#!/usr/bin/env bash
# Preflight for the primary-checkout synchronization assignment. Read-only: it verifies, it never
# fetches, merges, commits or edits. `.xezar/skills/xezar-integration.md` Mode B is the
# procedure; this is the gate in front of it.
#
# WHAT THIS IS FOR. Fast-forwarding the primary checkout is the one legitimate Worktree OFF
# assignment in this repository (plan r3 §4.6). Everything below exists to make sure the run in
# front of it is that assignment and not something that merely resembles it.
#
# N-A5, 2026-09-09 (#116 review). This header used to say the run "holds that manager's in-memory
# root lease *because it actually runs there*" — which asserts exactly what the paragraph below
# denies, and is the stronger-sounding of the two. Standing at the root is a CONSEQUENCE of a
# correct Worktree OFF launch, not a proof of one: a resume fallback also stands at the root and
# holds nothing. The real acquisition is the engine's, qualified in migration M2's RunManager
# fixtures against the pinned runtime; this script is downstream of that and adds nothing to it.
#
# WHAT IT CANNOT DO — READ THIS BEFORE TRUSTING ANYTHING IT PRINTS.
# It cannot prove the lease. The lease is Xezar's own in-memory state, held by the manager process;
# a shell script started by an agent can neither read it nor acquire it, and any "lease: held" flag
# an agent could write would be exactly the self-assertion this refuses to accept. Lease acquisition
# is qualified in ENGINE-LEVEL fixtures and by launch topology, not here. What this script does is
# narrower and honest: it refuses the topologies that CANNOT hold the lease — a linked worktree, a
# resume that fell back to the root, and a run with repository locking disabled — and it says so
# rather than claiming the converse.
#
# WHY A WORKTREE RUN CANNOT DO THIS BY MOVING. A Worktree ON task that runs `git -C <primary>` has
# not acquired anything; it has only changed a path argument. The lease belongs to where the run
# actually executes. `launch.worktree` below is that rule, and it is the reason this file exists
# separately from `worktree-preflight.sh` rather than as a flag on it.
#
# NO SOURCE EDIT, NO COMMIT, EVER. This assignment fast-forwards a branch pointer. It does not
# author content at the root, and nothing here should ever be read as permission to.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
usage: root-sync-preflight.sh --expected-root <path> --expected-branch <branch>
                              --expected-target <full-sha> --authority <path>

Read-only. Verifies that THIS run is the root-synchronization assignment and that the primary
checkout is in a state where a clean fast-forward to a fixed target is the only possible outcome.

  --expected-root    the primary checkout this run must be executing in
  --expected-branch  the branch the root must already be on (normally `main`)
  --expected-target  the 40-character SHA to fast-forward TO, fixed in advance
  --authority        the record explicitly authorizing this synchronization

It refuses a linked worktree, a resumed run that fell back to the root, disabled repository
locking, a wrong or dirty root, a moved branch and any target that is not a fast-forward.
It does NOT prove the manager's lease — see the header.
EOF
}

EXPECTED_ROOT="" EXPECTED_BRANCH="" EXPECTED_TARGET="" AUTHORITY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expected-root) EXPECTED_ROOT="${2:-}"; shift 2 ;;
    --expected-branch) EXPECTED_BRANCH="${2:-}"; shift 2 ;;
    --expected-target) EXPECTED_TARGET="${2:-}"; shift 2 ;;
    --authority) AUTHORITY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'root-sync-preflight: unknown argument "%s"\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

failures=()
notes=()
fail() { failures+=("[$1] $2"); }
note() { notes+=("$1"); }

# --- Arguments. Nothing is defaulted; a guessed root is the accident this prevents. -------------
[ -n "$EXPECTED_ROOT" ]   || fail args.expected-root "--expected-root is required and is never inferred"
[ -n "$EXPECTED_BRANCH" ] || fail args.expected-branch "--expected-branch is required"
[ -n "$EXPECTED_TARGET" ] || fail args.expected-target "--expected-target is required; the target is fixed before the run, not chosen during it"
[ -n "$AUTHORITY" ]       || fail args.authority "--authority is required"
if [ -n "$EXPECTED_TARGET" ] && ! printf '%s' "$EXPECTED_TARGET" | grep -qE '^[0-9a-f]{40}$'; then
  fail args.expected-target "--expected-target must be a full 40-character SHA, got \"$EXPECTED_TARGET\""
fi

if [ ${#failures[@]} -gt 0 ]; then
  printf '=== root-sync preflight ===\n\nREFUSED — the request is not well-formed:\n'
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi

# --- Identity of the run we are actually in -------------------------------------------------------
if ! resolve_task_paths >/dev/null 2>&1; then
  fail identity.unresolved "could not resolve this checkout's identity; refusing rather than assuming a root run"
  printf '=== root-sync preflight ===\n\nREFUSED:\n'
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi

note "MAIN_ROOT     $MAIN_ROOT"
note "TASK_CWD      $TASK_CWD"
note "IS_WORKTREE   $IS_WORKTREE"
note "BRANCH        $BRANCH"
note "HEAD          $HEAD_SHA"

# 1. THE RULE THAT MATTERS MOST. A Worktree ON run holds no root lease, and cannot obtain one by
#    changing directory or by passing `git -C`. Refuse it here rather than let it act.
if [ "$IS_WORKTREE" = "1" ]; then
  fail launch.worktree "this run is executing in a LINKED WORKTREE ($TASK_CWD). A worktree run holds no root lease and cannot acquire one by changing its working directory or by using \`git -C <root>\`. Root synchronization is a separate Worktree OFF assignment; relaunch it as one."
fi

# 2. The legacy resume fallback (`src/workflows/run.ts`, resume cwd selection). Current
#    recorded isolated runs fail closed if restoration fails; older records without isolation
#    identity can still select the repository root. Such a legacy run can be
#    standing at the root WITHOUT being the root assignment, and it is the one path that produces a
#    root-looking run that never acquired anything. A run id whose worktree directory still exists
#    while we are executing at the root is that shape.
#
# N-A4, 2026-09-09 (#116 review). The fallback test needs a run id to ask its question against.
# When `XEZ_TASK_ID` was missing or malformed the whole block was skipped SILENTLY, and the script
# could still print OK — folding an unasked question into a pass. An unobserved precondition is not
# a satisfied one. The identity is now required: the runtime supplies it to every agent step
# (`src/workflows/run.ts`, `RunManager.agentEnv`), so this asks for nothing new; it only refuses to pretend when it is absent.
if [ "$IS_WORKTREE" = "0" ]; then
  if [ -z "${XEZ_TASK_ID:-}" ]; then
    fail identity.unbound "XEZ_TASK_ID is not set, so the launch-versus-fallback question could not be asked at all. That check is INCOMPLETE, not passed. A root assignment runs as an agent step and is given its run id; if it is missing, stop and report rather than proceeding on an unobserved precondition."
  elif ! valid_task_id "$XEZ_TASK_ID"; then
    fail identity.malformed "XEZ_TASK_ID is \"$XEZ_TASK_ID\", which is not a well-formed run id. The fallback check cannot be evaluated against it, so it is INCOMPLETE, not passed."
  elif [ -d "${WORKTREES_DIR:-$MAIN_ROOT/.local/xezar/worktrees}/$XEZ_TASK_ID" ]; then
    fail launch.fallback "run $XEZ_TASK_ID is executing at the ROOT while its own worktree directory still exists. That is the resume fallback, not the root assignment: it holds no lease. Refusing."
  else
    note "run id $XEZ_TASK_ID is bound and has no worktree directory — consistent with a Worktree OFF launch, and NOT proof of a lease"
  fi
fi

# 3. Locking. `XEZ_DISABLE_REPO_LOCK` removes the very serialization this assignment depends on.
#    It is never set in this repository, and a run that sets it is not a run that may sync the root.
if [ -n "${XEZ_DISABLE_REPO_LOCK:-}" ]; then
  fail lease.locking-disabled "XEZ_DISABLE_REPO_LOCK is set (\"${XEZ_DISABLE_REPO_LOCK}\"). Repository locking is what serializes root work; with it disabled there is nothing to serialize against. Never set it."
fi

# 4. The root really is the expected root.
expected_root_real="$(abs_real_dir "$EXPECTED_ROOT" 2>/dev/null || printf '%s' "$EXPECTED_ROOT")"
if [ "$TASK_CWD" != "$expected_root_real" ]; then
  fail root.identity "this run is in \"$TASK_CWD\" but --expected-root is \"$expected_root_real\""
fi
if [ "$TASK_CWD" != "$MAIN_ROOT" ]; then
  fail root.not-primary "\"$TASK_CWD\" is not the primary checkout (\"$MAIN_ROOT\")"
fi

# 5. Branch and cleanliness. A fast-forward of a dirty checkout is not a fast-forward.
if [ "$BRANCH" != "$EXPECTED_BRANCH" ]; then
  fail root.branch "the root is on \"$BRANCH\", not the expected \"$EXPECTED_BRANCH\""
fi
if task_tree_is_dirty; then
  fail root.dirty "the primary checkout has uncommitted changes. Synchronization never carries someone's work along, and this assignment may not commit."
fi
if unresolved_git_operation >/dev/null 2>&1; then
  fail root.git-operation "a git operation is in progress at the root"
fi

# 6. Authority, scoped to this exact target.
if [ ! -f "$AUTHORITY" ]; then
  fail authority.missing "no authorization record at \"$AUTHORITY\". A missing authorization is a PROPOSAL awaiting a decision, not a failed sync."
else
  grep -qF "$EXPECTED_TARGET" "$AUTHORITY" \
    || fail authority.target "the record at \"$AUTHORITY\" does not name target $EXPECTED_TARGET; an authorization that does not pin a revision is not one"
fi

# 7. The target, and that it is genuinely a fast-forward. Anything else would rewrite the root's
#    history, which this assignment may never do.
if git cat-file -e "${EXPECTED_TARGET}^{commit}" 2>/dev/null; then
  if [ "$HEAD_SHA" = "$EXPECTED_TARGET" ]; then
    note "the root is ALREADY at $EXPECTED_TARGET — nothing to do; report the no-op rather than acting"
  elif git merge-base --is-ancestor "$HEAD_SHA" "$EXPECTED_TARGET" 2>/dev/null; then
    note "target $EXPECTED_TARGET is a descendant of HEAD — a clean fast-forward is possible"
  else
    fail target.not-fast-forward "target $EXPECTED_TARGET is NOT a descendant of the root's HEAD ($HEAD_SHA). Only a clean fast-forward is permitted here; a merge, a rebase or a reset at the root is out of scope and destructive."
  fi
else
  fail target.unknown "target $EXPECTED_TARGET is not a commit in this repository. Fetch it first, then re-run; this check does not fetch."
fi

# --- Verdict --------------------------------------------------------------------------------------
printf '=== root-sync preflight ===\n'
for n in "${notes[@]}"; do printf '  %s\n' "$n"; done
printf '  expected root   %s\n' "$expected_root_real"
printf '  expected branch %s\n' "$EXPECTED_BRANCH"
printf '  expected target %s\n' "$EXPECTED_TARGET"
printf '  authority       %s\n' "$AUTHORITY"

if [ ${#failures[@]} -gt 0 ]; then
  printf '\nROOT-SYNC PREFLIGHT REFUSED (%d):\n' "${#failures[@]}"
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  printf '\nDo not synchronize. Do not work around this by changing directory or by `git -C`.\n'
  exit 1
fi

printf '\nROOT-SYNC PREFLIGHT OK — a clean fast-forward to %s is the only outcome this state allows.\n' \
  "$EXPECTED_TARGET"
printf '\nTHIS DOES NOT PROVE THE MANAGER LEASE. The lease is Xezar in-memory state; no script an\n'
printf 'agent runs can read or acquire it, and a flag an agent writes would prove only that it wrote\n'
printf 'a flag. What was checked is that this run is NOT one of the topologies that certainly hold\n'
printf 'no lease. Authority is carried, never verified here.\n'
exit 0
