#!/usr/bin/env bash
# The narrow path through an interrupted authorized merge — and nothing wider.
#
# THE PROBLEM. `worktree-preflight.sh` refuses any in-flight git operation, which is right: after
# the fact, "a merge is in progress" cannot be told apart from "something started a merge nobody
# authorized", and a half-finished tree is exactly what the cockpit's autosave will not commit.
# But the refusal had no exit. The only ways out of a conflicted merge are `--abort` and `reset`,
# both of which DESTROY the resolution work, and a failed preflight is not permission for either.
# So an authorized merge that was interrupted mid-conflict was simply stuck.
#
# THE SHAPE OF THE FIX. Move the decision earlier. Before the merge, `record-intent` writes down
# exactly what is about to happen — which run, which worktree, which branch, which repository,
# the commit HEAD is at and the commit coming in, plus the authorization the run is acting under.
# If the merge is then interrupted, `check` has something to compare the interrupted state
# against, and admits it only when every field matches. `commit` then finishes that same merge,
# and refuses if the parents moved or a conflict is still unresolved.
#
# Usage:
#   merge-recovery.sh record-intent --incoming <ref-or-sha> \
#                     --authorization <reference> --scope <what it covers> [--replace]
#   merge-recovery.sh check                       is the interrupted merge the recorded one?
#   merge-recovery.sh commit [git commit args...] finish that merge, guarded
#   merge-recovery.sh status                      what is recorded and what is in flight
#   merge-recovery.sh --help
#
# WHAT THIS IS NOT — read this before quoting a green `check` at anyone.
#
#   - NOT authority. `--authorization` is a string this script carries. Nothing here checks that a
#     human wrote it, that it is current, or that its scope covers this merge. These are
#     MECHANICAL IDENTITY CHECKS: same run, same tree, same two commits. "The operation matches
#     what was written down" is a different claim from "the operation was allowed", and only the
#     first is made here.
#   - NOT a sandbox. A passing `check` lets the ordinary preflight pass. It confines nothing: no
#     file is protected, no command is intercepted. "Only resolution edits and staging" is a
#     PROMPT-LEVEL scope in the recovery skill, enforced by a person reading the diff.
#   - NOT an abort. This script never runs `merge --abort`, `reset`, `checkout --force` or
#     `clean`, in any mode, for any reason. Discarding a partly resolved merge is a preservation
#     decision with no undo, and it belongs to the leader, explicitly, each time.
#   - NOT a way to commit an unresolved merge. That stays forbidden, exactly as before.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

usage() {
  printf 'usage: merge-recovery.sh <verb> [options]\n\n'
  printf 'verbs:\n'
  printf '  record-intent   write down an authorized merge BEFORE starting it\n'
  printf '                  --incoming <ref-or-sha>    the commit to be merged in (required)\n'
  printf '                  --authorization <ref>      the human decision this acts under (required)\n'
  printf '                  --scope <text>             what that decision covers (required)\n'
  printf '                  --replace                  overwrite a resolved earlier intent\n'
  printf '  check           verify an interrupted merge against the recorded intent\n'
  printf '  commit          finish that merge — refuses moved parents or unresolved conflicts\n'
  printf '  status          print the recorded intent and the current git state\n'
  printf '  --help          this text\n\n'
  printf 'It never aborts, resets or resolves anything. An abort is a separate leader decision.\n'
}

VERB="${1:-}"
case "$VERB" in
  record-intent | check | commit | status) shift ;;
  --help | -h)
    usage
    exit 0
    ;;
  "")
    usage >&2
    exit 2
    ;;
  *)
    printf 'merge-recovery: unknown verb "%s". Supported: record-intent | check | commit | status | --help\n' "$VERB" >&2
    printf '\n' >&2
    usage >&2
    exit 2
    ;;
esac

resolve_task_paths || {
  printf 'merge-recovery: could not resolve the checkout or the project config.\n' >&2
  exit 1
}

# Identity is not optional here. Every verb reads or writes THIS run's intent file, and a run id
# that could not be derived would mean guessing whose merge this is — which is the exact mistake
# the intent record exists to prevent.
if [ -z "${TASK_ID:-}" ]; then
  printf 'merge-recovery: the run id could not be derived from %s.\n' "$TASK_CWD" >&2
  printf 'Without it there is no way to say whose merge this is. Refusing; nothing was written.\n' >&2
  exit 3
fi
INTENT="$(merge_intent_path)"

# --- record-intent -------------------------------------------------------------------------
if [ "$VERB" = "record-intent" ]; then
  INCOMING=""
  AUTHORIZATION=""
  SCOPE=""
  REPLACE=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --incoming) INCOMING="${2:-}"; shift 2 ;;
      --authorization) AUTHORIZATION="${2:-}"; shift 2 ;;
      --scope) SCOPE="${2:-}"; shift 2 ;;
      --replace) REPLACE="--replace"; shift ;;
      *)
        printf 'merge-recovery record-intent: unknown option "%s"\n\n' "$1" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
  missing=()
  [ -n "$INCOMING" ] || missing+=("--incoming")
  [ -n "$AUTHORIZATION" ] || missing+=("--authorization")
  [ -n "$SCOPE" ] || missing+=("--scope")
  if [ ${#missing[@]} -gt 0 ]; then
    printf 'merge-recovery record-intent: missing %s\n' "${missing[*]}" >&2
    exit 2
  fi

  # An intent is recorded BEFORE the merge, in a clean tree. Recording one while a merge is
  # already in flight would be writing the authorization after the fact, from the state it is
  # supposed to authorize — the record would then agree with anything it found.
  if op="$(unresolved_git_operation)"; then
    printf 'merge-recovery record-intent: a git operation is already in progress (%s).\n' "$op" >&2
    printf 'An intent must be recorded BEFORE the merge starts. One written now would be derived from\n' >&2
    printf 'the very state it claims to authorize, which proves nothing. Refusing.\n' >&2
    exit 1
  fi
  if ! "$SCRIPT_DIR/worktree-preflight.sh" >/dev/null; then
    printf 'merge-recovery record-intent: the strict preflight failed, so this checkout is not a\n' >&2
    printf 'validated Xezar worktree. Run .xezar/checks/worktree-preflight.sh to see which predicate.\n' >&2
    exit 1
  fi

  incoming_sha="$(git -C "$TASK_CWD" rev-parse --verify --quiet "${INCOMING}^{commit}" 2>/dev/null)"
  if [ -z "$incoming_sha" ]; then
    printf 'merge-recovery record-intent: "%s" does not resolve to a commit in this checkout.\n' "$INCOMING" >&2
    exit 1
  fi

  # `repo_identity` is run once into a variable rather than inline, so a failure to read the root
  # commit is visible here instead of arriving as an empty field inside the record.
  repo_json="$(repo_identity)"
  intent_json="$(node -e '
    const [runId, worktree, branch, repo, head, incoming, incomingRef, authorization, scope] = process.argv.slice(1);
    const identity = JSON.parse(repo);
    process.stdout.write(JSON.stringify({
      runId, worktree, branch,
      repoRootCommit: identity.rootCommit ?? "",
      repoOrigin: identity.origin ?? null,
      expectedHeadSha: head,
      expectedIncomingSha: incoming,
      incomingRef,
      authorizationReference: authorization,
      authorizationScope: scope,
    }));
  ' "$TASK_ID" "$TASK_CWD" "$BRANCH" "$repo_json" "$HEAD_SHA" "$incoming_sha" "$INCOMING" "$AUTHORIZATION" "$SCOPE")"

  if ! node "$SCRIPT_DIR/lib/merge-intent.mjs" record --path "$INTENT" --json "$intent_json" $REPLACE; then
    exit 1
  fi
  printf '=== merge intent recorded ===\n'
  printf '  run           %s\n' "$TASK_ID"
  printf '  worktree      %s\n' "$TASK_CWD"
  printf '  branch        %s\n' "$BRANCH"
  printf '  HEAD          %s\n' "$HEAD_SHA"
  printf '  incoming      %s (%s)\n' "$incoming_sha" "$INCOMING"
  printf '  authorization %s\n' "$AUTHORIZATION"
  printf '  scope         %s\n' "$SCOPE"
  printf '\nThe authorization is CARRIED, not verified. Nothing here checked that it exists or covers\n'
  printf 'this merge; a person reads it. Recovery matches identity, never authority.\n'
  exit 0
fi

# --- status ---------------------------------------------------------------------------------
if [ "$VERB" = "status" ]; then
  printf '=== merge recovery status ===\n'
  printf '  run           %s\n' "$TASK_ID"
  printf '  CWD           %s\n' "$TASK_CWD"
  printf '  branch        %s\n' "$BRANCH"
  printf '  HEAD          %s\n' "$HEAD_SHA"
  printf '  intent file   %s\n' "$INTENT"
  if [ -r "$INTENT" ]; then
    printf '  intent        recorded\n'
  else
    printf '  intent        none recorded\n'
  fi
  ops="$(git_operations_in_progress | tr '\n' ' ')"
  printf '  git operation %s\n' "${ops:-none}"
  unmerged="$(git -C "$TASK_CWD" diff --name-only --diff-filter=U 2>/dev/null | wc -l | tr -d ' ')"
  printf '  unmerged      %s path(s)\n' "$unmerged"
  exit 0
fi

# --- check ------------------------------------------------------------------------------------
# Delegated in full to the preflight's `--merge-recovery` mode, so there is exactly one
# implementation of "is this the recorded merge, in an otherwise sound checkout". A second copy
# here would be a second thing to keep in step, and the two would eventually disagree.
if [ "$VERB" = "check" ]; then
  if [ "$#" -ne 0 ]; then
    printf 'merge-recovery check: takes no arguments (got: %s)\n' "$*" >&2
    exit 2
  fi
  exec "$SCRIPT_DIR/worktree-preflight.sh" --merge-recovery
fi

# --- commit --------------------------------------------------------------------------------
#
# Finish the recorded merge. Three assertions beyond the recovery check, each closing a way the
# tree could have moved while a human was resolving conflicts:
#
#   1. the recovery check still passes — same run, same branch, same two parents;
#   2. no unmerged index entries remain. Git refuses this itself, but refusing it HERE names the
#      files, and the point is that an unresolved merge commit stays forbidden;
#   3. the parents have not moved between the check and the write.
if [ "$VERB" = "commit" ]; then
  if ! "$SCRIPT_DIR/worktree-preflight.sh" --merge-recovery; then
    printf '\nmerge-recovery commit: the recovery check failed, so no commit was attempted.\n' >&2
    printf 'Read the predicate tags above. Do NOT abort or reset to get past this.\n' >&2
    exit 1
  fi

  resolve_task_paths || exit 1

  if unmerged_paths_present; then
    printf '\nmerge-recovery commit: these paths are still unmerged:\n' >&2
    git -C "$TASK_CWD" diff --name-only --diff-filter=U | sed 's/^/  - /' >&2
    printf '\nAn unresolved merge may not be committed. Resolve every conflict and stage it first.\n' >&2
    exit 1
  fi

  # Re-read the parents immediately before the write. The recovery check read them too, but a
  # commit, a reset or a second merge between the two reads would make the check's answer describe
  # a state that no longer exists.
  git_dir="$(task_git_dir)" || exit 1
  head_now="$(git -C "$TASK_CWD" rev-parse HEAD 2>/dev/null)"
  incoming_now="$(head -1 "$git_dir/MERGE_HEAD" 2>/dev/null | tr -d '[:space:]')"
  want_head="$(node -e '
    const fs = require("node:fs");
    try { process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).expectedHeadSha ?? ""); } catch {}
  ' "$INTENT")"
  want_incoming="$(node -e '
    const fs = require("node:fs");
    try { process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).expectedIncomingSha ?? ""); } catch {}
  ' "$INTENT")"
  if [ "$head_now" != "$want_head" ] || [ "$incoming_now" != "$want_incoming" ]; then
    printf '\nmerge-recovery commit: the merge parents moved between the check and this write.\n' >&2
    printf '  expected HEAD     %s\n' "$want_head" >&2
    printf '  actual   HEAD     %s\n' "$head_now" >&2
    printf '  expected incoming %s\n' "$want_incoming" >&2
    printf '  actual   incoming %s\n' "$incoming_now" >&2
    exit 1
  fi

  printf '\nmerge-recovery: committing the recorded merge in %s on %s\n' "$TASK_CWD" "$BRANCH"
  git -C "$TASK_CWD" commit "$@"
  rc=$?

  # WHAT WAS ACTUALLY WRITTEN. Every assertion above runs BEFORE the commit, so an argument that
  # changes WHICH commit is produced is covered by none of them. `--amend` is the case that matters:
  # it would take an existing commit's parents instead of HEAD + MERGE_HEAD. Git refuses it here
  # ("cannot amend" during a merge) and that refusal is pinned by a regression case — but relying on
  # an external tool's behaviour without checking the result is a guard with a hole in it, and a
  # dry-run-style no-op that exits 0 without writing anything would also have gone unnoticed.
  #
  # So the outcome is verified: HEAD must now be a NEW commit whose parents are exactly the two the
  # intent recorded, in order. A mismatch is reported loudly and the exit status becomes a failure —
  # and nothing is rolled back. Automatic recovery from an unexpected commit would be a second
  # destructive guess on top of the first, and reset is the leader's decision, not this script's.
  if [ "$rc" -eq 0 ]; then
    new_head="$(git -C "$TASK_CWD" rev-parse HEAD 2>/dev/null)"
    parents="$(git -C "$TASK_CWD" rev-list --parents -n 1 HEAD 2>/dev/null | cut -d' ' -f2-)"
    expected_parents="$want_head $want_incoming"
    if [ "$new_head" = "$head_now" ]; then
      printf '\nmerge-recovery: `git commit` reported success but HEAD did not move (%s).\n' "$new_head" >&2
      printf 'No merge commit was written — a no-op or dry-run style invocation. Nothing was rolled back;\n' >&2
      printf 'the merge is still in progress and still recorded.\n' >&2
      rc=1
    elif [ "$parents" != "$expected_parents" ]; then
      printf '\nmerge-recovery: the commit that was written is NOT the recorded merge.\n' >&2
      printf '  expected parents  %s\n' "$expected_parents" >&2
      printf '  actual parents    %s\n' "$parents" >&2
      printf '  new HEAD          %s\n' "$new_head" >&2
      printf '\nNothing was rolled back: undoing a commit is destructive and is the leader'"'"'s decision.\n' >&2
      printf 'Report this exactly as printed.\n' >&2
      rc=1
    else
      printf '  verified      HEAD %s has exactly the two recorded parents\n' "$new_head"
    fi
  fi

  if [ "$rc" -eq 0 ]; then
    printf '\nThe merge is committed. The intent record stays on disk as the history of what was\n'
    printf 'authorized; it is not deleted here. Normal readiness, gates and evidence resume now —\n'
    printf 'the ordinary strict preflight applies again from this point.\n'
  fi
  exit "$rc"
fi
