#!/usr/bin/env bash
# The ONE entry point for finishing a resumed run.
#
# WHY IT EXISTS. "Continue" in the cockpit is not a workflow replay. It appends one synthetic
# agent step and re-runs no `command:` step, so a resumed run that reaches DONE has run no
# readiness check, no gates and no evidence step — and carries no fresh evidence at all. Every
# skill that had to cope with that wrote its own recovery sequence in prose, and each one drifted:
# a different order, a different idea of what could be reused, a different silence about what was
# skipped. The sequence belongs in one place that actually runs it.
#
# WHAT IT DOES, in order:
#   1. identity      — the strict preflight, in the caller's CWD. A resumed run whose worktree
#                      could not be re-materialized lands in the PRIMARY checkout, and that must
#                      stop here rather than three steps later;
#   2. steering      — prints where this run's checkpoint, handoff and BLOCKED file are, and stops
#                      on a BLOCKED file. It does not interpret them: reading late instructions is
#                      the agent's job, and a script that summarised them would be inventing;
#   3. inputs        — are the installed dependencies still the ones the manifests describe;
#   4. reuse         — is the sealed evidence still eligible to certify THIS revision, asked
#                      through the same code the handoff asks with. Only a verified compatible
#                      outcome is reused;
#   5. gates         — re-runs the required stage when reuse is refused, or when asked;
#   6. seal          — records the new attempt as this run's evidence.
#
# WHAT IT IS NOT:
#   - it is NOT a scheduler. It runs the stages in front of it, once, and exits. It does not queue
#     work, retry loops, or decide when to run again;
#   - it does NOT open, update or comment on a pull request, and it can never touch another task's
#     PR. Publication is the handoff stage's job and it needs a human's branch;
#   - it does NOT hide a failure to make a resume look clean. A refused reuse, a failed gate and an
#     unresolvable identity each exit non-zero with their reason.
#
# Usage:
#   resume-complete.sh                 identity, steering, inputs, reuse; run the gates only if
#                                      the reuse is refused, then seal
#   resume-complete.sh --dry-run       report what WOULD be re-run and change nothing
#   resume-complete.sh --force-gates   re-run the gates even when the sealed evidence is eligible
#   resume-complete.sh --help
#
# EXIT STATUS.
#   default / --force-gates : 0 only when the run ends with evidence eligible for this exact revision.
#   --dry-run               : 0 means the PLAN was produced, never that anything is certified. A dry
#                             run changes nothing and runs no gate, so it cannot certify; it exits 2
#                             when it found a required stage, so `resume-complete.sh --dry-run && …`
#                             cannot read as a green light.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

usage() {
  printf 'usage: resume-complete.sh [--dry-run | --force-gates | --help]\n\n'
  printf '  (no flag)      drive the remaining stages: identity, steering, inputs, reuse,\n'
  printf '                 gates if needed, seal\n'
  printf '  --dry-run      report which stages would re-run; change nothing. Exits 2 when a stage\n'
  printf '                 is outstanding, so it can never read as a certification\n'
  printf '  --force-gates  re-run the gates even when the sealed evidence is still eligible\n'
  printf '  --help         this text\n\n'
  printf 'It opens no pull request and touches no other task. Handoff stays a separate stage.\n'
}

DRY_RUN=0
FORCE_GATES=0
case "${1:-}" in
  "") ;;
  --help | -h)
    usage
    exit 0
    ;;
  --dry-run) DRY_RUN=1 ;;
  --force-gates) FORCE_GATES=1 ;;
  *)
    printf 'resume-complete: unknown argument "%s". Supported: --dry-run | --force-gates | --help\n' "$1" >&2
    printf '\n' >&2
    usage >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  shift
  printf 'resume-complete: takes exactly one flag (extra arguments: %s)\n' "$*" >&2
  exit 2
fi

step() { printf '\n--- %s ---\n' "$*"; }
note() { printf '  %s\n' "$*"; }

printf '=== resumed completion ===\n'

# --- 1. Identity ---------------------------------------------------------------------------
step "1. identity"
if ! "$SCRIPT_DIR/worktree-preflight.sh"; then
  printf '\nRESUME REFUSED: the strict preflight failed. Read its predicate tags — a resumed run\n' >&2
  printf 'that could not re-materialize its worktree lands in the PRIMARY checkout, and that is\n' >&2
  printf 'one of several ways this fails. Nothing further ran.\n' >&2
  exit 1
fi
resolve_task_paths || exit 1
if [ -z "${TASK_ID:-}" ]; then
  printf '\nRESUME REFUSED: no run id, so this run'"'"'s evidence cannot be located.\n' >&2
  exit 3
fi

EVIDENCE_DIR="$(task_evidence_dir)"
MANIFEST="$(task_manifest_path)"

# --- 2. Checkpoint and late steering ---------------------------------------------------------
step "2. checkpoint and late steering"
note "evidence      $EVIDENCE_DIR"
note "manifest      $MANIFEST"
if [ -r "$MANIFEST" ]; then note "manifest      present"; else note "manifest      absent — setup never ran, or the evidence was reclaimed"; fi
if [ -n "${XEZ_HANDOFF_FILE:-}" ] && [ -r "${XEZ_HANDOFF_FILE:-}" ]; then
  note "handoff       $XEZ_HANDOFF_FILE (resume notes live here — read them)"
else
  note "handoff       XEZ_HANDOFF_FILE is not set in this step's environment"
fi
# A `command:` step is spawned with the manager's environment, which carries no XEZ_* variables,
# so the absence above is normal and is not itself a fault. Saying so beats a silent blank.
if [ -f "$EVIDENCE_DIR/BLOCKED" ]; then
  printf '\n--- BLOCKED ---\n'
  cat "$EVIDENCE_DIR/BLOCKED"
  printf '\nRESUME REFUSED: this task recorded an unresolved decision. Resolving it is a human'"'"'s\n' >&2
  printf 'call, and no gate run would change that. Nothing further ran.\n' >&2
  exit 1
fi
note "blocked       no BLOCKED file"

# The repair budget survives the resume because it lives in this run's own evidence directory,
# keyed by run id, in the PRIMARY checkout — the same place the gate attempts live. A Continue,
# a backend switch and a replacement run therefore CONTINUE the count; none of them starts a
# fresh allowance, and `resume-free-budget` is the falsifier that says so.
printf '\n'
"$SCRIPT_DIR/phase-record.sh" counters 2>/dev/null | sed 's/^/  /'

# --- 3. Input readiness -----------------------------------------------------------------------
step "3. dependency and input readiness"
DEPS_FRESH=0
if deps_are_fresh; then
  DEPS_FRESH=1
  note "deps          match the lockfile and every workspace manifest"
else
  note "deps          STALE or absent — a gate run here installs before it judges anything"
fi
note "head          $HEAD_SHA"
note "branch        $BRANCH"
if task_tree_is_dirty; then
  note "tree          DIRTY — uncommitted work is not on the branch, so it is not in the PR either"
  DIRTY=1
else
  note "tree          clean"
  DIRTY=0
fi

# --- 4. Reuse ------------------------------------------------------------------------------------
# Asked through `gate-results.mjs verify --require-current`, which is the same question, in the
# same code, that the handoff asks. A resume that judged reuse by its own weaker rule would be a
# second opinion nobody had reviewed.
step "4. can the sealed evidence be reused here"
COMMAND_LIST_ID="$("$SCRIPT_DIR/repo-gates.sh" --list --json 2>/dev/null | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d)).on("end", () => {
    try { const id = JSON.parse(raw).commandListId; if (typeof id === "string") process.stdout.write(id); } catch {}
  });' 2>/dev/null)"

# The observations of THIS checkout. They are what makes the reuse question complete: without them
# the answer is about the seal's internal consistency, not about the revision in front of us. This
# script claimed to ask "the same question, in the same code, that the handoff asks" while asking
# only part of it — so a source-only repair commit after sealing was answered ELIGIBLE and the gates
# were skipped for a revision they had never seen.
#
# `--repo` stays the primary checkout: it is an object-lookup root, and the objects live in the
# shared git directory. The revision comparison is these two arguments, taken from TASK_CWD.
CURRENT_HEAD="$(git -C "$TASK_CWD" rev-parse HEAD 2>/dev/null)"
CURRENT_TREE_FP="$(tree_fingerprint)"

REUSABLE=0
if reuse_out="$(node "$SCRIPT_DIR/lib/gate-results.mjs" verify \
  --manifest "$MANIFEST" \
  --repo "$MAIN_ROOT" \
  --run-id "$TASK_ID" \
  --command-list-id "$COMMAND_LIST_ID" \
  --deps-fingerprint "$(deps_fingerprint)" \
  --install-gate "$(install_gate_name)" \
  --current-head "$CURRENT_HEAD" \
  --current-tree-fingerprint "$CURRENT_TREE_FP" \
  --require-current 2>&1)"; then
  REUSABLE=1
  printf '%s\n' "$reuse_out"
  note "reuse         ELIGIBLE — this evidence certifies the current revision"
else
  printf '%s\n' "$reuse_out"
  note "reuse         REFUSED — the reasons above are the required stages to re-run"
fi

# --- 5 and 6. Re-run what is missing or invalidated, then seal -------------------------------------
step "5. required stages"
NEED_GATES=1
if [ "$REUSABLE" -eq 1 ] && [ "$FORCE_GATES" -eq 0 ]; then NEED_GATES=0; fi

if [ "$NEED_GATES" -eq 0 ]; then
  note "gates         reuse accepted, so the gates are NOT re-run"
elif [ "$FORCE_GATES" -eq 1 ]; then
  note "gates         re-run (--force-gates)"
else
  note "gates         re-run (the sealed evidence is not eligible for this revision)"
fi

# A gate-driven re-entry is a REPAIR RETURN, and the workflow gets two. An exhausted counter —
# or a history nobody can account for, which reads as unknown and not as zero — blocks another
# one here, before the resume spends a full gate run to arrive at the same refusal. This is the
# gate-return counter only: the self-review and quality-repair budgets are separate and none of
# them substitutes for another, so a spent self-review budget never blocks a re-run of the gates.
GATE_RETURN_BLOCKED=0
if [ "$NEED_GATES" -eq 1 ] && "$SCRIPT_DIR/phase-record.sh" counters --exhausted gate-return >/dev/null 2>&1; then
  GATE_RETURN_BLOCKED=1
  note "budget        the \"gate-return\" counter is EXHAUSTED or its history is unknown"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n--- dry run ---\n'
  printf '  deps install  %s\n' "$([ "$DEPS_FRESH" -eq 1 ] && printf 'no' || printf 'yes, as the first gate')"
  printf '  gates         %s\n' "$([ "$NEED_GATES" -eq 1 ] && printf 'would re-run' || printf 'would be reused')"
  printf '  seal          %s\n' "$([ "$NEED_GATES" -eq 1 ] && printf 'would be re-recorded' || printf 'unchanged')"
  printf '  tree          %s\n' "$([ "$DIRTY" -eq 1 ] && printf 'DIRTY — commit before the gates, or the seal will refuse it' || printf 'clean')"
  printf '  budget        %s\n' "$([ "$GATE_RETURN_BLOCKED" -eq 1 ] && printf 'BLOCKED — the gate-return counter is spent or unknown' || printf 'a gate-return round is available')"
  printf '\nDRY RUN: nothing was run and nothing was written.\n'
  if [ "$NEED_GATES" -eq 1 ]; then
    printf 'A required stage is outstanding, so this exits 2. A dry run reports a PLAN; it never\n'
    printf 'certifies anything, and exiting 0 here made `--dry-run && ...` read as a green light.\n'
    exit 2
  fi
  printf 'No required stage is outstanding. This is still a plan, not a certification — the\n'
  printf 'certifying run is the one without --dry-run.\n'
  exit 0
fi

if [ "$NEED_GATES" -eq 1 ]; then
  if [ "$GATE_RETURN_BLOCKED" -eq 1 ]; then
    printf '\nRESUME REFUSED: a gate re-run here is a gate-repair return, and that counter is spent or\n' >&2
    printf 'its history is unknown. Unknown is not zero. Stop and report the remaining failure with its\n' >&2
    printf 'evidence; never lower a severity, a threshold or a mandatory check to get past it, and never\n' >&2
    printf 'pay for this round out of a different counter — none of the three substitutes for another.\n' >&2
    printf 'Reconcile an unknown history first: bash .xezar/checks/phase-record.sh counters init --none\n' >&2
    printf '(or --predecessor <runId> for a replacement run). Genuinely new scope needs a new accepted plan.\n' >&2
    exit 1
  fi
  if [ "$DIRTY" -eq 1 ]; then
    printf '\nRESUME REFUSED: the tree has uncommitted changes and the gates are about to run.\n' >&2
    printf 'Sealing would refuse the result anyway — certification is about a committed revision,\n' >&2
    printf 'and uncommitted work is not on the branch. Commit the repair first, then run this again.\n' >&2
    exit 1
  fi
  printf '\n--- running the gates ---\n'
  # This is the run's canonical gate run on the resumed path — it replaces the workflow's own
  # `gates` step — so it declares the producer the seal requires (#676 PR 2).
  if ! "$SCRIPT_DIR/repo-gates.sh" --producer gates; then
    printf '\nRESUME INCOMPLETE: the gates failed. The failure is recorded as an attempt under\n' >&2
    printf '%s/gates/ and it stays there. Fix the cause and run this again;\n' "$EVIDENCE_DIR" >&2
    printf 'do not seal an older passing attempt in its place.\n' >&2
    exit 1
  fi
  printf '\n--- sealing ---\n'
  if ! "$SCRIPT_DIR/worktree-preflight.sh" --record-gate-evidence; then
    printf '\nRESUME INCOMPLETE: the gates passed but the evidence could not be sealed. The reasons\n' >&2
    printf 'above say what would change that; a re-run is not always the answer.\n' >&2
    exit 1
  fi
fi

# --- Verdict ----------------------------------------------------------------------------------
printf '\n=== resumed completion ===\n'
printf '  run           %s\n' "$TASK_ID"
printf '  head          %s\n' "$(git -C "$TASK_CWD" rev-parse HEAD)"
printf '  gates         %s\n' "$([ "$NEED_GATES" -eq 1 ] && printf 're-run and sealed' || printf 'reused (verified eligible)')"
printf '  evidence      %s\n' "$EVIDENCE_DIR"
printf '\nRESUME COMPLETE — evidence is eligible for this revision.\n'
printf 'This is NOT a handoff. The pull request, its body and its CI observation are the handoff\n'
printf 'stage'"'"'s work, on this run'"'"'s own branch. Nothing here opened or updated one.\n'
exit 0
