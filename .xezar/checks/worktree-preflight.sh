#!/usr/bin/env bash
# Fail-closed isolation check for a Xezar task.
#
# Xezar owns the worktree: it creates `.local/xezar/worktrees/<runId>` on the branch
# `xez/<first 8 of runId>`, forked from the project's `baseBranch`. Nothing in this
# repository may create, move or remove a worktree itself. This script only *verifies*
# that the checkout it was started in really is that worktree, and refuses to let the
# task proceed when it is not.
#
# The refusal that matters most: a legacy resume with no remaining isolation identity
# can reach the PRIMARY checkout. Current recorded isolated runs fail closed first;
# the remaining cwd fallback is in
# the engine's run manager:
#   const cwd = record?.worktreePath && existsSync(record.worktreePath)
#     ? record.worktreePath : this.repoRoot;
# A run that quietly landed there would edit the human's working tree. This check turns
# that silent fallback into a stopped run.
#
# It relies on NO cockpit environment variable. A workflow `command:` step is spawned with
# the manager process's own environment (the engine's `runCheckStep`),
# while `XEZ_TASK_ID` is exported only to the spawned agent (`RunManager.agentEnv`). Identity is
# therefore derived from the worktree path.
#
# Usage:
#   worktree-preflight.sh                      full isolation check (writing workflows)
#   worktree-preflight.sh --allow-root         tolerate the primary checkout (read-only
#                                              workflows: review, triage)
#   worktree-preflight.sh --readiness          full check, plus: refuse when the task marked
#                                              itself blocked, when its branch has no
#                                              commits over the base (#312), or when its tree
#                                              has uncommitted changes (#320). Runs BEFORE the
#                                              gates so an unresolved decision stops the
#                                              workflow without paying for a full gate run
#                                              first. Both evidence modes repeat the first two
#   worktree-preflight.sh --merge-recovery     full check with ONE narrow exception: an
#                                              interrupted merge that exactly matches this run's
#                                              recorded merge intent is admitted instead of
#                                              refused. Every other assertion is unchanged
#   worktree-preflight.sh --record-gate-evidence
#                                              full check, refuse when the task marked
#                                              itself blocked, then SEAL the gate attempt
#                                              `repo-gates.sh` recorded — after checking it is
#                                              complete, passing, the newest for this head, and
#                                              bound to this exact revision, command list and
#                                              inputs. It never asserts a pass of its own
#   worktree-preflight.sh --verify-gate-evidence
#                                              full check, then refuse when anything
#                                              changed since that seal
#   worktree-preflight.sh --help               print the supported modes and exit 0
#
# Exit 0 only when every applicable assertion passed. An assertion that could not be
# evaluated counts as a failure, never as a pass.
#
# DIAGNOSTICS. Every failure carries the PREDICATE that failed, as a dotted tag, alongside the
# actual CWD, the resolved run id and the branch. The script used to report only prose, and its
# callers then narrated every rejection as a wrong-directory problem — which is one cause among
# many. "branch.owned-by-run" and "gitstate.clean" are not CWD errors, and a reader chasing the
# wrong cause loses the time the check was meant to save.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

SUPPORTED_MODES="(no flag) | --allow-root | --readiness | --merge-recovery | --record-gate-evidence | --verify-gate-evidence | --help"

usage() {
  printf 'usage: worktree-preflight.sh [MODE]\n\n'
  printf 'modes:\n'
  printf '  (no flag)                 strict isolation check, for a writing workflow\n'
  printf '  --allow-root              also accept the primary checkout, for a read-only workflow\n'
  printf '  --readiness               strict, plus refuse when this task recorded a BLOCKED decision,\n'
  printf '                            its branch has no commits over the base (unless the task recorded\n'
  printf '                            a VERIFICATION of an existing revision), or its tree is dirty\n'
  printf '  --merge-recovery          strict, but admit the ONE interrupted merge this run recorded\n'
  printf '                            an intent for before starting it. Admits nothing else, and\n'
  printf '                            never aborts, resets or resolves anything\n'
  printf '  --record-gate-evidence    strict + blocked check, then seal the recorded gate attempt\n'
  printf '  --verify-gate-evidence    strict, then refuse when anything changed since that seal\n'
  printf '  --help                    this text\n'
}

MODE="strict"
case "${1:-}" in
  "") ;;
  --help | -h)
    usage
    exit 0
    ;;
  --allow-root) MODE="allow-root" ;;
  --readiness) MODE="readiness" ;;
  --merge-recovery) MODE="merge-recovery" ;;
  --record-gate-evidence) MODE="record-gate-evidence" ;;
  --verify-gate-evidence) MODE="verify-gate-evidence" ;;
  *)
    printf 'worktree-preflight: unknown argument "%s". Supported: %s\n' "$1" "$SUPPORTED_MODES" >&2
    printf '\n' >&2
    usage >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  shift
  printf 'worktree-preflight: takes exactly one mode (extra arguments: %s). Supported: %s\n' "$*" "$SUPPORTED_MODES" >&2
  exit 2
fi

failures=()
# fail <predicate> <message>. The predicate is the machine-readable name of the assertion that
# failed; the message is what a person does about it.
fail() { failures+=("[$1] $2"); }
info() { printf '  %s\n' "$*"; }

printf '=== worktree preflight (%s) ===\n' "$MODE"

if ! resolve_task_paths; then
  printf 'FAIL: could not resolve the checkout or the project config — cannot establish isolation.\n' >&2
  exit 1
fi

info "MAIN_ROOT     $MAIN_ROOT"
info "TASK_CWD      $TASK_CWD"
info "IS_WORKTREE   $IS_WORKTREE"
info "BRANCH        $BRANCH"
info "BASE_BRANCH   $BASE_BRANCH"
info "TASK_ID       ${TASK_ID:-<undetermined>} (${TASK_ID_SOURCE:-none})"

# The environment may not carry an id at all in a check step; when it does, it must agree
# with the worktree the run is actually in.
if [ -n "${TASK_ID_CONFLICT:-}" ]; then
  fail identity.no-conflict "task identity conflict — $TASK_ID_CONFLICT"
fi

# --- The bootstrap exception -------------------------------------------------------
#
# Exactly one kind of task legitimately runs in the primary checkout with write access:
# a migration bootstrap that has to edit this very machinery. It is narrow on purpose —
# the override must name THIS run, so it cannot be exported once and left on for every
# later task. It is only satisfiable where XEZ_TASK_ID exists at all, i.e. inside an agent
# step; a check step in the primary checkout can never unlock it.
#
# The legacy `CEZ_ALLOW_ROOT_BOOTSTRAP` name is NOT honoured. A stale Cezar-era export
# unlocks nothing here.
ROOT_BOOTSTRAP=0
if [ -n "${KIT_TEST_ALLOW_ROOT_BOOTSTRAP:-}" ]; then
  if [ -n "${XEZ_TASK_ID:-}" ] && [ "$KIT_TEST_ALLOW_ROOT_BOOTSTRAP" = "$XEZ_TASK_ID" ]; then
    ROOT_BOOTSTRAP=1
    info "root bootstrap exception ACTIVE for task $XEZ_TASK_ID"
  else
    fail identity.bootstrap-names-this-run "KIT_TEST_ALLOW_ROOT_BOOTSTRAP is set but does not equal this run's XEZ_TASK_ID — the exception must name the run it applies to."
  fi
fi

# --- Isolation ----------------------------------------------------------------------
if [ "$IS_WORKTREE" -eq 1 ]; then
  # The worktree must be the one Xezar makes, in the place Xezar makes it: exactly one
  # level under <MAIN_ROOT>/.local/xezar/worktrees. A checkout somewhere else is not a Xezar
  # task tree, whatever else it may be, and never a write target.
  if [ "$TASK_ID_SOURCE" != "worktree-path" ]; then
    fail isolation.xezar-owned-path "checkout is a linked worktree but not at $WORKTREES_DIR/<runId> — Xezar did not create it"
  else
    leaf="$TASK_ID"
    # Registered with git, and registered as pointing HERE.
    if [ ! -d "$MAIN_ROOT/.git/worktrees/$leaf" ]; then
      fail isolation.worktree-registered "git has no worktree registration at .git/worktrees/$leaf — the tree is unregistered or stale"
    fi
    if ! git -C "$MAIN_ROOT" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $TASK_CWD"; then
      fail isolation.worktree-listed "git worktree list does not report $TASK_CWD — refusing to work in an unregistered tree"
    fi

    # Xezar's branch for THIS run, and NOTHING else. Matching the shape `xez/<8 hex>` is not
    # enough: a stale branch from another run has the same shape, and working on it would put
    # two runs on one branch.
    #
    # There is no opt-out, and that is deliberate. The cockpit's recovery path re-creates the
    # worktree and reattaches `xez/<id8>` — it knows nothing about any other branch. A worktree
    # switched onto some other branch therefore silently loses that work the moment retention
    # reclaims it and a resume restores the tree. A marker file or a manifest flag cannot change
    # what the engine restores, so no such exception is offered here.
    #
    # A legacy `cez/*` branch is refused by the same rule, with no compatibility path. Those
    # branches remain in the repository under their original names; they are history, not work
    # a Xezar run may adopt.
    #
    # To work an existing pull request: resume the run that opened it, which still owns its
    # own worktree and branch. A pull request from before worktree mode is a
    # leader-coordinated migration, not something a run decides for itself — see
    # `.xezar/skills/xezar-review-response.md`.
    expected="$(expected_task_branch)"
    if [ "$BRANCH" != "$expected" ]; then
      fail branch.owned-by-run "branch is \"$BRANCH\" but this worktree is run $leaf, whose branch is \"$expected\". Xezar restores only its own branch, so work on any other one is lost on reclaim. Resume the run that owns the branch instead of switching this one."
    fi
  fi
elif [ "$MODE" = "allow-root" ]; then
  info "primary checkout accepted: this workflow is read-only"
elif [ "$ROOT_BOOTSTRAP" -eq 1 ]; then
  info "primary checkout accepted under the named bootstrap exception"
else
  fail isolation.not-primary-checkout "running in the PRIMARY checkout ($MAIN_ROOT), not in a Xezar worktree. Xezar either never created one or fell back to the repo root on resume. Stop — do not edit."
fi

# --- Branch safety ------------------------------------------------------------------
# Never commit on the integration or release branch. In the primary checkout a read-only
# workflow may legitimately sit on main, so the assertion is scoped to the cases that
# can write.
if [ "$IS_WORKTREE" -eq 1 ] || [ "$MODE" != "allow-root" ]; then
  case "$BRANCH" in
    main | master)
      fail branch.not-integration "HEAD is on \"$BRANCH\" — a task must never commit on the integration or release branch"
      ;;
  esac
fi

# --- Base ---------------------------------------------------------------------------
if git -C "$TASK_CWD" rev-parse --verify --quiet "refs/heads/$BASE_BRANCH" >/dev/null 2>&1; then
  info "base ref      refs/heads/$BASE_BRANCH"
elif git -C "$TASK_CWD" rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH" >/dev/null 2>&1; then
  info "base ref      refs/remotes/origin/$BASE_BRANCH"
else
  fail base.resolvable "base branch \"$BASE_BRANCH\" resolves to neither a local branch nor origin/$BASE_BRANCH"
fi

# --- No half-finished git operation --------------------------------------------------
#
# In every mode but one, ANY in-flight git operation is a refusal: a half-finished merge is the
# exact state the cockpit's autosave will not commit, so letting the next step run would hand it
# a tree nobody can vouch for.
#
# `--merge-recovery` is that one mode, and it widens nothing else. It admits an interrupted merge
# ONLY when the merge matches, field for field, an intent this run recorded BEFORE starting it:
# same run, same worktree, same branch, same repository, the same commit HEAD was at, and the same
# commit being merged in. A merge nobody wrote down, another run's merge, a rebase, a cherry-pick,
# or a merge running alongside any of those, is refused exactly as before.
#
# Three things this mode deliberately does NOT do:
#   - it does not abort, reset or clean anything. Those destroy resolution work and they are a
#     separate, explicit leader decision. A failed preflight is never permission for one;
#   - it does not verify AUTHORITY. It matches identities. Whether the authorization reference in
#     the intent is real, and whether its scope covers this merge, is a human's reading;
#   - it does not confine what an agent edits afterwards. Nothing here is a sandbox. "Only
#     resolution edits" is a scope in the recovery skill's prompt, checked by a person in the diff.
if [ "$MODE" = "merge-recovery" ]; then
  if [ -z "${TASK_ID:-}" ]; then
    fail identity.run-id-resolved "the run id could not be determined, so this run's merge intent cannot be located. Recovery is refused: guessing which run's merge this is would be the whole failure."
  else
    merge_head=""
    git_dir="$(task_git_dir 2>/dev/null || printf '')"
    [ -n "$git_dir" ] && [ -r "$git_dir/MERGE_HEAD" ] &&
      merge_head="$(head -1 "$git_dir/MERGE_HEAD" 2>/dev/null | tr -d '[:space:]')"
    # More than one MERGE_HEAD line is an octopus merge. It is not refused for being exotic — it is
    # refused because an intent records ONE incoming parent, so there is nothing to match the rest
    # against, and admitting it would mean admitting parents nobody wrote down.
    merge_head_lines="$( [ -n "$git_dir" ] && [ -r "$git_dir/MERGE_HEAD" ] && wc -l < "$git_dir/MERGE_HEAD" || printf '0' )"

    operations_json="$(git_operations_in_progress | node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d)).on("end", () => {
        process.stdout.write(JSON.stringify(raw.split("\n").map((s) => s.trim()).filter(Boolean)));
      });')"
    identity_json="$(repo_identity)"

    observed="$(node -e '
      const [branch, cwd, runId, head, incoming, operations, repo] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        identity: { run: runId, worktree: cwd, branch, repo: JSON.parse(repo).rootCommit },
        parents: { head, incoming },
        operations: JSON.parse(operations),
      }));
    ' "$BRANCH" "$TASK_CWD" "$TASK_ID" "$HEAD_SHA" "$merge_head" "$operations_json" "$identity_json")"

    printf '\n--- merge recovery ---\n'
    if [ "${merge_head_lines:-0}" -gt 1 ]; then
      fail merge.single-incoming-parent "MERGE_HEAD names $merge_head_lines incoming commits (an octopus merge). A merge intent records one incoming parent, so the others match nothing — refusing."
    fi
    recovery_out="$(node "$SCRIPT_DIR/lib/merge-intent.mjs" check --path "$(merge_intent_path)" --json "$observed" 2>&1)"
    recovery_rc=$?
    printf '%s\n' "$recovery_out"
    case "$recovery_rc" in
      0)
        info "interrupted merge ADMITTED — it matches this run's recorded intent"
        info "authority NOT checked here: the reference above is carried, not verified"
        ;;
      3)
        # No intent at all. This is a different fault from a mismatch, and saying so matters: it
        # usually means the merge was started without recording one, and recovery is not
        # retroactive — an intent written now would describe a state it never authorized.
        fail merge.intent-recorded "this run recorded no merge intent, so there is nothing an interrupted merge could be matched against. An intent is recorded BEFORE a merge; writing one now would authorize the merge with itself."
        ;;
      *)
        fail merge.matches-recorded-intent "the interrupted git state does not match the merge this run recorded an intent for (failed predicates above). Recovery is refused. Do NOT abort or reset to get past this — that destroys resolution work and is the leader's decision, not this check's."
        ;;
    esac
  fi
elif op="$(unresolved_git_operation)"; then
  fail gitstate.clean "an unresolved git operation is in progress ($op) — resolve or abort it before any further step"
fi

# --- Ignore hygiene -------------------------------------------------------------------
# The cockpit autosaves with `git add -A` and `--no-verify` at every turn end, at run
# finalize and before a draft PR (the engine's `autosaveCommit`, called by
# `src/workflows/run.ts`; only the `periodic` timer is opt-in). Everything
# that must not be committed has to be ignored BEFORE the first turn ends, and .local/xezar/ must
# never become tracked — otherwise scratch evidence lands in the branch and in the PR.
# Directory rules are probed through a child path (".local/xezar/probe", not ".local"): a
# `dir/` pattern is directory-only, so `git check-ignore` answers "not ignored" for a
# directory that does not exist yet — which is precisely the moment before a run creates it.
for ignored in .local/xezar/probe node_modules/probe dist/probe coverage/probe \
               .local/xezar/scratch/probe .local/xezar/worktrees/probe \
               .local/xezar/runtime/runs.json .local/xezar/runtime/ui-state.json; do
  if ! git -C "$TASK_CWD" check-ignore -q "$ignored" 2>/dev/null; then
    fail ignore.hygiene "\"${ignored%/probe}\" is not git-ignored — autosave would commit scratch, runtime or build output"
  fi
done
tracked_local="$(git -C "$TASK_CWD" ls-files -- .local/xezar | head -5)"
if [ -n "$tracked_local" ]; then
  fail ignore.local-untracked ".local/xezar/ contains tracked files, which .gitignore cannot protect: $(printf '%s' "$tracked_local" | tr '\n' ' ')"
fi

# --- The contract is present ------------------------------------------------------------
for required in AGENTS.md .xezar/checks/repo-gates.sh; do
  [ -r "$TASK_CWD/$required" ] || fail contract.present "\"$required\" is missing from this checkout — the task has no contract to follow"
done

# --- Blocked-scope guard and gate evidence --------------------------------------------
#
# An intermediate `XEZ:ASK` does NOT park the run: only the last agent step of a workflow
# is interactive. Until #317 a question raised while implementing printed as text and the
# workflow marched on into the gates; an engine with #317 fails a non-final step that ends
# without `XEZ:DONE` (the engine's `unfinishedStepReason`), but a
# task on an older build does not get that stop. This is the explicit stop that does not
# depend on the engine: a task that could not resolve its own scope writes a BLOCKED file,
# and the workflow goes no further.
#
# It is checked in `--readiness` FIRST, which the workflows run between the implementation
# step and the gates. Stopping there costs a second; stopping after the gates would burn a
# full build, test and coverage run to reach the same answer. It is re-checked at the two
# evidence modes so the stop cannot be skipped by a resumed or hand-driven run.
if [ "$MODE" = "readiness" ] || [ "$MODE" = "record-gate-evidence" ] || [ "$MODE" = "verify-gate-evidence" ]; then
  if [ -z "${TASK_ID:-}" ]; then
    fail identity.run-id-resolved "the run id could not be determined, so this task's evidence directory cannot be located"
  else
    evidence_dir="$(task_evidence_dir)"
    if [ -f "$evidence_dir/BLOCKED" ]; then
      printf '\n--- BLOCKED ---\n'
      cat "$evidence_dir/BLOCKED"
      printf '\n'
      fail scope.not-blocked "the task recorded an unresolved decision in $evidence_dir/BLOCKED — the workflow stops here. No gates, no pull request, until a human resolves it."
    fi
  fi

  # --- The phase record and the accepted-criteria input ----------------------------------
  #
  # `SDLC.md` § Task phases names the dispositions one task records and `.xezar/docs/phase-record.md`
  # names the files. Until this check both were prose: nothing created a record and nothing noticed
  # when a phase left none — and a disposition nobody wrote is indistinguishable from a phase
  # nobody ran. That is the `phase-hole` failure, and readiness is where it has to stop, for the
  # same reason BLOCKED does: a second here, or a full gate run to reach the same answer.
  #
  # Scoped to the phases that have ALREADY RUN by the time readiness does. The read-only roles
  # (code-review, design-review, qa, business-analysis, research) never reach this mode at all, so
  # nothing here asks a reviewer for an author's facts.
  #
  # `CRITERIA` is the AC INPUT, and it is validated rather than merely counted: a file that exists
  # but names no criterion and no accepting authority is the `template-is-acceptance` failure — a
  # shipped template or a mutable label standing in for this task's own accepted input.
  if [ "$MODE" = "readiness" ] || [ "$MODE" = "record-gate-evidence" ]; then
    if [ -n "${TASK_ID:-}" ]; then
      # THE PRODUCER'S EXIT STATUS IS READ (#503 review N2). This used to be a process
      # substitution whose status was discarded, and `phase-record.sh` exits 1 with NO stdout
      # when it cannot resolve the run id — so "the writer could not look" and "there is nothing
      # to refuse" were the same silence, and readiness passed with no phase record at all. That
      # is the same empty-input fail-open the security stage's own refusal exists for. A refusal
      # always arrives WITH lines, so non-zero AND empty is the unmeasured case, and it fails.
      phase_predicates="$("$SCRIPT_DIR/phase-record.sh" check --predicates 2>/dev/null)"
      phase_rc=$?
      if [ "$phase_rc" -ne 0 ] && [ -z "$phase_predicates" ]; then
        fail phase.record-readable "the phase record could not be read: phase-record.sh check exited $phase_rc and reported nothing, so whether this task's phase dispositions exist could not be measured. An unmeasured record is not an absent refusal. Run bash .xezar/checks/phase-record.sh check from the task worktree xezar created and fix what it reports."
      fi
      while IFS='|' read -r predicate message; do
        [ -n "$predicate" ] || continue
        fail "$predicate" "$message"
      done <<< "$phase_predicates"
    fi
  fi

  # --- The branch carries this task's work (#312) ---------------------------------------
  #
  # No BLOCKED file is ABSENT input, not a verdict: it cannot tell "decided, and done" from "the
  # author step stopped without writing anything". Run b86c6066 was the second: its author step
  # ended on a question in prose, the engine marked it done, readiness found no BLOCKED file, and
  # the evidence step sealed the base commit itself — a valid seal for a branch holding none of the
  # task's work. This asks the question the file cannot answer, and depends on no agent complying.
  #
  # "Empty" means HEAD is an ancestor of the base — not HEAD == base tip, which a base that moved on
  # after the fork would defeat. Both spellings of the base are tried, and either one containing
  # HEAD refuses. A check that cannot be evaluated refuses too. Plain preflight is untouched: setup
  # runs it on a fresh, rightly empty branch.
  #
  # One kind of run is honestly commitless: a verification of a revision that already exists — QA of
  # another PR's branch, an acceptance re-run over one final revision. Run c5a99f15 (QA of #311) was
  # one, and this check refused it. Its git state is byte-identical to b86c6066's (HEAD in the base,
  # a clean tree), and both used the same workflow as a test-writing run would, so neither git nor
  # the workflow name can separate them. Only the task knows, so the task must SAY it: a
  # VERIFICATION record in its evidence directory, naming the commit it verified and where the
  # findings are. An absent record keeps the refusal — the default is still "an empty branch is not
  # work". A record that does not name a real commit refuses too. BLOCKED is checked first and wins.
  #
  # A second, related kind is honestly commitless for the opposite reason: a fix that correctly
  # landed on a DIFFERENT branch (#402). `address-review-findings` runs a fresh worktree on a fresh
  # task branch, but `xezar-review-response` pushes the fix to the PR's own branch on purpose — it
  # must not rename or adopt a task branch. Run `ba255b58` did exactly this (commit `b38e835` on
  # `xez/939d7d68`) and still failed here, because this predicate only knew about VERIFICATION. A
  # DELIVERED record, same directory, same shape, one field swapped ("head/base" for "delivered",
  # instead of "verified"): the branch it landed on, the commit now at its tip, and the commit that
  # branch was at before this run. Accepted only when that branch really carries that head, and that
  # head really descends from that base — a record naming an unrelated pair of shas proves nothing.
  empty_base=""
  checked_bases=0
  if [ -z "${HEAD_SHA:-}" ]; then
    fail branch.has-own-commits "HEAD could not be resolved, so whether this branch carries any work cannot be evaluated"
  else
    for base_ref in "refs/heads/$BASE_BRANCH" "refs/remotes/origin/$BASE_BRANCH"; do
      git -C "$TASK_CWD" rev-parse --verify --quiet "$base_ref" >/dev/null 2>&1 || continue
      checked_bases=$((checked_bases + 1))
      git -C "$TASK_CWD" merge-base --is-ancestor "$HEAD_SHA" "$base_ref" >/dev/null 2>&1
      case $? in
        0) empty_base="$base_ref" ;;
        1) info "own commits   $(git -C "$TASK_CWD" rev-list --count "$base_ref..$HEAD_SHA" 2>/dev/null) over $base_ref" ;;
        *) fail branch.has-own-commits "could not compare HEAD with $base_ref, so whether this branch carries any work cannot be evaluated" ;;
      esac
    done
    if [ "$checked_bases" -eq 0 ]; then
      fail branch.has-own-commits "no base ref resolved, so whether this branch carries any work cannot be evaluated"
    elif [ -n "$empty_base" ]; then
      verification_record="${evidence_dir:+$evidence_dir/VERIFICATION}"
      delivery_record="${evidence_dir:+$evidence_dir/DELIVERED}"
      if [ -n "$verification_record" ] && [ -f "$verification_record" ]; then
        verified_sha="$(sed -n 's/^verified:[[:space:]]*\([0-9a-fA-F]\{40\}\)[[:space:]]*$/\1/p' "$verification_record" | head -n 1)"
        verified_findings="$(sed -n 's/^findings:[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p' "$verification_record" | head -n 1)"
        if [ -z "$verified_sha" ]; then
          fail scope.verification-record "branch \"$BRANCH\" has no commits over its base, and its VERIFICATION record ($verification_record) has no \"verified: <full 40-character commit sha>\" line, so it cannot say what this run verified."
        elif ! git -C "$TASK_CWD" cat-file -e "$verified_sha^{commit}" 2>/dev/null; then
          fail scope.verification-record "branch \"$BRANCH\" has no commits over its base, and its VERIFICATION record names $verified_sha, which is not a commit in this repository. Fetch the revision you verified, or correct the record."
        elif [ -z "$verified_findings" ]; then
          fail scope.verification-record "branch \"$BRANCH\" has no commits over its base, and its VERIFICATION record ($verification_record) has no \"findings: <where the result is posted>\" line."
        else
          info "own commits   none — a verification-only run, by its VERIFICATION record"
          info "verified      $verified_sha"
          info "findings      $verified_findings"
        fi
      elif [ -n "$delivery_record" ] && [ -f "$delivery_record" ]; then
        delivered_branch="$(sed -n 's/^branch:[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p' "$delivery_record" | head -n 1)"
        delivered_head="$(sed -n 's/^head:[[:space:]]*\([0-9a-fA-F]\{40\}\)[[:space:]]*$/\1/p' "$delivery_record" | head -n 1)"
        delivered_base="$(sed -n 's/^base:[[:space:]]*\([0-9a-fA-F]\{40\}\)[[:space:]]*$/\1/p' "$delivery_record" | head -n 1)"
        if [ -z "$delivered_branch" ]; then
          fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record ($delivery_record) has no \"branch: <name>\" line naming the branch the fix was pushed to."
        elif [ -z "$delivered_head" ]; then
          fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record ($delivery_record) has no \"head: <full 40-character commit sha>\" line."
        elif [ -z "$delivered_base" ]; then
          fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record ($delivery_record) has no \"base: <full 40-character commit sha>\" line."
        elif ! git -C "$TASK_CWD" cat-file -e "$delivered_head^{commit}" 2>/dev/null; then
          fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record names head $delivered_head, which is not a commit in this repository. Fetch the revision you pushed, or correct the record."
        elif ! git -C "$TASK_CWD" cat-file -e "$delivered_base^{commit}" 2>/dev/null; then
          fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record names base $delivered_base, which is not a commit in this repository."
        else
          # `refs/heads/$delivered_branch` and `refs/remotes/origin/$delivered_branch` are both
          # writable by the very agent this check exists to hold accountable: `git commit-tree`
          # plus `git update-ref` manufactures either one without a single byte reaching the
          # network (#416 review). Only a LIVE query against the remote proves a push happened, so
          # the local and remote-tracking refs are no longer consulted at all — a stale or absent
          # remote branch now refuses exactly like a missing record would.
          remote_tip="$(git -C "$TASK_CWD" ls-remote origin "refs/heads/$delivered_branch" 2>/dev/null | awk '{print $1}' | head -n 1)"
          if [ -z "$remote_tip" ]; then
            fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record names branch \"$delivered_branch\", but a live \"git ls-remote origin refs/heads/$delivered_branch\" returned nothing — the branch does not exist on the remote, or the remote could not be reached. A local branch or remote-tracking ref is never accepted as proof of a push; push the branch, then correct or re-check the record."
          elif [ "$remote_tip" != "$delivered_head" ]; then
            fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record names head $delivered_head on branch \"$delivered_branch\", but origin's LIVE tip for refs/heads/$delivered_branch is $remote_tip right now. The recorded head was never actually pushed there, or has since been superseded — fetch is not proof either, since a fetch only updates a ref this agent already controls."
          elif [ "$delivered_head" = "$delivered_base" ]; then
            fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record's head and base are the same commit ($delivered_head) — no new commits were delivered."
          elif ! git -C "$TASK_CWD" merge-base --is-ancestor "$delivered_base" "$delivered_head" 2>/dev/null; then
            fail scope.delivery-record "branch \"$BRANCH\" has no commits over its base, and its DELIVERED record's head $delivered_head is not a descendant of its recorded base $delivered_base — that is not a fix delivered over the reviewed head."
          else
            info "own commits   none — delivered to origin/$delivered_branch instead, by its DELIVERED record"
            info "delivered     $delivered_head (over $delivered_base), verified live against origin"
          fi
        fi
      else
        fail branch.has-own-commits "branch \"$BRANCH\" has no commits over its base — HEAD ${HEAD_SHA:0:12} is already contained in $empty_base. There is no work here to gate, seal or hand off. If the author step stopped for a decision, it must write the task's BLOCKED file. If this run only verifies a revision that already exists and was never asked to change source (QA of another branch, an acceptance re-run), record that in ${evidence_dir:-the task evidence directory}/VERIFICATION with a \"verified: <commit sha>\" line and a \"findings: <where the result is posted>\" line. If this run's fix correctly landed on a different branch than this one (address-review-findings pushing to the PR's own branch), record that in ${evidence_dir:-the task evidence directory}/DELIVERED with a \"branch: <name>\" line, a \"head: <commit sha now at that branch's tip>\" line and a \"base: <commit sha it was at before this run>\" line. A run that was asked to change source on its own branch must not write either record."
      fi
    fi
  fi
fi

# --- The work is committed before the gates judge it (#320) ------------------------------
#
# The evidence step seals a COMMIT, and refuses a dirty tree ("the task tree has uncommitted
# changes"). Readiness used to let that tree through, so four tasks in one day paid for a complete
# gate run — typecheck, the whole vitest suite, unit tests, build, package test — and only then
# learned the result could never be sealed. The same predicate the sealer uses, asked here, in the
# one mode that runs straight before the gates. Only `--readiness`: plain preflight runs on trees
# that are rightly mid-work, and the read-only roles (business-analysis, research) never run it.
if [ "$MODE" = "readiness" ] && task_tree_is_dirty; then
  dirty_paths="$(cd "$TASK_CWD" && git status --porcelain 2>/dev/null | head -5 | sed 's/^...//' | tr '\n' ' ')"
  fail gitstate.committed "the task tree has uncommitted changes (${dirty_paths% }). The gates judge the commit and the seal refuses a dirty tree, so running them now would spend a full gate run for nothing. Commit the work — bash .xezar/checks/worktree-git.sh commit -m \"...\" — then re-run readiness and the gates."
fi

# --- Sealing, and what changed about it ------------------------------------------------
#
# This step used to WRITE `checks: [{name:"repo-gates", result:"pass"}]` whenever it was
# reached, with nothing behind the claim but the workflow's step order. A resumed run, a
# hand-driven step or a gates step whose output was truncated past its summary all sealed a
# pass that nothing had established.
#
# It now SEALS what `repo-gates.sh` recorded. The judgement lives in `lib/gate-results.mjs`,
# which refuses a missing, interrupted, failed, malformed, stale or superseded attempt, and
# refuses an older passing attempt whenever a newer one for the same head failed or never
# finished — at seal time AND, through `--verify-gate-evidence` below, at handoff time. It also
# refuses an attempt whose recorded producer is the AUTHOR: the workflow's `gates` step passes
# `--producer gates` and is the only run that certifies the tree (#676 PR 2), so an author-side
# attempt at the same head can no longer prove it to itself. This step can no longer produce a
# pass; it can only accept or refuse one.
if [ ${#failures[@]} -eq 0 ] && [ "$MODE" = "record-gate-evidence" ]; then
  # Sourced for `_gate_json`, so the expectations below are built by the same code that built
  # the record they are compared against. It defines functions only; nothing runs on source.
  # shellcheck source=lib/gate-record.sh
  . "$SCRIPT_DIR/lib/gate-record.sh"
  manifest="$(task_manifest_path)"
  # `--list` runs no gate; it prints the canonical list and its digest and exits.
  command_list_id="$("$SCRIPT_DIR/repo-gates.sh" --list 2>/dev/null | awk '/^commandListId/{print $2}')"
  # The security stage's name in the CURRENT canonical list. The sealer requires the attempt to
  # carry that stage's structured result, and taking the name from the live list — rather than
  # from the record being sealed — is what stops a record from deciding whether it has to have
  # one. An empty answer means the list carries no security stage and the requirement is off.
  #
  # WHICH IS WHY THE LIST HAS TO BE READ SUCCESSFULLY FIRST (#503 review N2). Every error stream
  # here used to be discarded, so a list that could not be produced or parsed switched the whole
  # sealing requirement off, silently — "we looked and there is none" and "we could not look"
  # were the same empty string. `gate-results.mjs` already separates the two for
  # `--command-list-id` (unmeasured becomes an unknown input); this now does the same, and the
  # node reader no longer swallows a parse error.
  gate_list_json="$("$SCRIPT_DIR/repo-gates.sh" --list --json 2>/dev/null)"
  gate_list_rc=$?
  security_gate=""
  install_gate=""
  security_gate_measured=0
  if [ "$gate_list_rc" -eq 0 ] && [ -n "$gate_list_json" ]; then
    security_gate="$(printf '%s' "$gate_list_json" | node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d)).on("end", () => {
        const gate = JSON.parse(raw).gates.find((g) => g.command === ".xezar/checks/security-scan.sh");
        if (gate) process.stdout.write(gate.name);
      });' 2>/dev/null)" && security_gate_measured=1
    # The install gate, the one a verified-current skip may satisfy - named by the live list too.
    install_gate="$(printf '%s' "$gate_list_json" | node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d)).on("end", () => {
        try { const name = JSON.parse(raw).gates[0].name; if (typeof name === "string") process.stdout.write(name); } catch {}
      });' 2>/dev/null)"
  fi
  dirty=false
  task_tree_is_dirty && dirty=true

  if [ "$security_gate_measured" -eq 0 ]; then
    # Nothing is sealed until the list reads. Sealing here would record a pass whose security
    # requirement was decided by a failure to look.
    fail evidence.gate-list-readable "the canonical gate list could not be read (repo-gates.sh --list --json exited $gate_list_rc, or its output could not be parsed), so whether this attempt must carry a security result could not be measured. An unmeasured requirement is not an absent one. Run bash .xezar/checks/repo-gates.sh --list --json and fix what it reports."
  elif seal_digest="$(node "$SCRIPT_DIR/lib/gate-results.mjs" seal \
    --manifest "$manifest" \
    --gates-root "$(task_gates_dir)" \
    --json "$(_gate_json \
      "headSha=$HEAD_SHA" \
      "treeSha=$(head_tree_sha)" \
      "branch=$BRANCH" \
      "commandListId=$command_list_id" \
      "securityGate=$security_gate" \
      "installGate=$install_gate" \
      "treeFingerprint=$(tree_fingerprint)" \
      "depsFingerprint=$(deps_fingerprint)" \
      "dirty:j=$dirty")")"; then
    info "gate evidence sealed  $HEAD_SHA"
    info "result digest         $seal_digest"
    security_status="$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.security.status 2>/dev/null)"
    if [ -n "$security_status" ]; then
      info "security stage        $security_status$([ "$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.security.reviewerRequired 2>/dev/null)" = "true" ] && printf ' — a named trust boundary changed; a human or a security reviewer is required' || printf '')"
      [ "$security_status" = "unknown" ] && info "                      unknown is NOT a pass: the reviewer reads the result before any quality verdict"
    fi
  else
    # No blanket "just re-run the gates" here. That advice was wrong for the one case that most
    # needed it: a malformed newest attempt whose order could not be recovered could not be
    # superseded by any number of fresh runs, so an agent following the message looped for ever.
    # The sealer knows which case it is in and prints the action that actually applies.
    fail evidence.sealable "the recorded gate evidence could not be sealed. Each reason above says what would change it; a re-run is not always the answer. A reason naming the author means this attempt came from an author-side run: the workflow's gates step is the canonical run, and it declares itself with --producer gates."
  fi
fi

if [ ${#failures[@]} -eq 0 ] && [ "$MODE" = "verify-gate-evidence" ]; then
  manifest="$(task_manifest_path)"
  schema="$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.schemaVersion 2>/dev/null)"
  recorded="$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.fingerprint 2>/dev/null)"
  if [ -z "$recorded" ]; then
    fail evidence.present "no post-gate evidence recorded for this task — the gates were never verified as green"
  elif [ -z "$schema" ]; then
    # Evidence written before the versioned contract. It stays readable as history and is
    # never promoted to a verified result by inference.
    fail evidence.schema-versioned "the recorded gate evidence predates the versioned contract and carries no attempt record — re-run .xezar/checks/repo-gates.sh."
  elif [ "$schema" != "1" ]; then
    fail evidence.schema-supported "the recorded gate evidence uses unsupported schema version $schema — refusing to interpret it."
  else
    current="$(tree_fingerprint)"
    if [ "$recorded" != "$current" ]; then
      fail evidence.tree-unchanged "the checkout changed after the green gate run (recorded $recorded, now $current). That evidence is void — re-run .xezar/checks/repo-gates.sh before handing off."
    else
      # The fingerprint answers one question — did the files move — and it is blind to the one
      # that used to slip through here. Re-running the gates changes no file, so a run whose
      # NEWEST attempt has now failed left this fingerprint identical and this step said
      # "unchanged", after which a draft PR quoted a green seal that the newest recorded outcome
      # for that exact head contradicted. Handoff and the auditor now ask the same question,
      # through the same code: is this seal eligible to certify what is being handed off NOW?
      if ! eligibility="$(node "$SCRIPT_DIR/lib/gate-results.mjs" verify \
        --manifest "$manifest" \
        --repo "$MAIN_ROOT" \
        --run-id "$TASK_ID" \
        --command-list-id "$("$SCRIPT_DIR/repo-gates.sh" --list --json 2>/dev/null | node -e '
            let raw = "";
            process.stdin.on("data", (d) => (raw += d)).on("end", () => {
              try { const id = JSON.parse(raw).commandListId; if (typeof id === "string") process.stdout.write(id); } catch {}
            });' 2>/dev/null)" \
        --deps-fingerprint "$(deps_fingerprint)" \
        --install-gate "$(install_gate_name)" \
        --current-head "$HEAD_SHA" \
        --current-tree-fingerprint "$current" \
        --require-current 2>&1)"; then
        printf '%s\n' "$eligibility"
        fail evidence.currently-eligible "the sealed gate evidence is not eligible to certify this handoff (reasons above). The sealed history is unchanged and stays auditable; what is refused is using it as THIS moment's pass."
      else
        info "gate evidence unchanged ($current)"
        info "gate evidence currently eligible"
        # The security stage's verdict travels with the handoff. A reviewer must be able to read
        # it from the PR without re-running anything, and `unknown` must arrive as `unknown`.
        security_status="$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.security.status 2>/dev/null)"
        if [ -n "$security_status" ]; then
          info "security stage        $security_status (sealed)"
          [ "$(node "$SCRIPT_DIR/lib/manifest.mjs" "$manifest" --get gateEvidence.security.reviewerRequired 2>/dev/null)" = "true" ] &&
            info "                      a named trust boundary changed — say so in the pull request body"
        fi
      fi
    fi
  fi
fi

# --- Verdict --------------------------------------------------------------------------
printf '\n'
if [ ${#failures[@]} -eq 0 ]; then
  printf 'PREFLIGHT OK — isolated at %s on %s\n' "$TASK_CWD" "$BRANCH"
  exit 0
fi
printf 'PREFLIGHT FAILED (%d):\n' "${#failures[@]}"
printf '  - %s\n' "${failures[@]}"
# The state the assertions were evaluated against, restated at the point of refusal. A caller
# that only forwards the exit status used to narrate this as "you are in the wrong directory",
# and the CWD is frequently not the problem: `branch.owned-by-run`, `gitstate.clean`,
# `ignore.hygiene` and every `evidence.*` predicate fail in exactly the right directory.
printf '\nchecked in this state:\n'
printf '  mode          %s\n' "$MODE"
printf '  CWD           %s\n' "$TASK_CWD"
printf '  primary       %s\n' "$MAIN_ROOT"
printf '  run           %s (%s)\n' "${TASK_ID:-<undetermined>}" "${TASK_ID_SOURCE:-none}"
printf '  branch        %s\n' "$BRANCH"
printf '\nEach line above is tagged with the PREDICATE that failed. Read the tag before assuming a\n'
printf 'wrong working directory — most of these fail in the right one.\n'
printf '\nDo not edit anything. Report this and stop.\n'
exit 1
