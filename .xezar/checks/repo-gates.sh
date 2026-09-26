#!/usr/bin/env bash
# Xezar project gates: the AGENTS/SDLC/.xezar/pipeline/config.json sequence,
# with dependency freshness and actual repository checks. UI smoke is separate.
# Usage:  .xezar/checks/repo-gates.sh [--fast] [--list] [--producer <author|gates>]
#   --producer <author|gates>
#           WHO ran the gates. The workflow's own `gates` step passes `gates`; an invocation
#           without the flag is the AUTHOR's, and `lib/gate-results.mjs` refuses to seal an
#           author's attempt. It is deliberately NOT part of the command-list id: the id names
#           the LIST of gates, and who invoked it is not a gate.
#   --fast  skip `npm ci` ONLY when the installed dependencies
#           still match the manifests. `--fast` is a request, not a promise: freshness is
#           verified against a fingerprint of package-lock.json, npm-shrinkwrap.json, root/workspace package.json,
#           .npmrc, patches/ and the Node/npm versions, and a stale or missing stamp installs anyway.
#           "node_modules exists" is deliberately NOT the test — an agent that touched the
#           lockfile mid-run leaves node_modules stale, and judging that tree would be a
#           false green. With `dependencies.units` set (lib/deps.mjs), the install gate is
#           `.xezar/checks/deps-restore.sh` and freshness is per unit.
#   --list  print the canonical gate list and its command-list id, and exit. Nothing runs.
#           The id is what binds a sealed result to the list it was produced by, so a gate
#           added or removed later cannot be quietly back-dated onto an older attempt.
#
# Exit 0 only when every gate ran AND passed. A gate that could not run counts as a
# failure, never as a pass.
#
# EVIDENCE. Every run records a gate attempt under the PRIMARY checkout at
# `.local/xezar/tasks/<runId>/gates/<headSha>/<attemptId>/`: one complete log per gate plus a
# versioned result record carrying each command's status, exit code, timing and log digest.
# The complete output goes to those logs; only a bounded excerpt reaches stdout, so a long
# gate can no longer push the summary out of a truncated cockpit view. The `evidence` step
# then READS that record. It does not assert a pass — see `lib/gate-results.mjs`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/gate-record.sh
. "$SCRIPT_DIR/lib/gate-record.sh"

# --- The canonical list ------------------------------------------------------------------
#
# Data, not control flow, so one place answers "which gates are required" for the runner, for
# `--list`, for the command-list id and for the sealing check. Commands are written
# repo-relative on purpose: an absolute path would make the id differ between checkouts and
# no two machines could ever agree that they ran the same list.
#
# The security stage sits at position TWO, immediately after the install and before every gate
# that produces a quality signal. That placement is the contract, not a preference: SDLC.md
# § Security before the quality verdict requires the security result to be resolved before
# anyone gives a quality verdict, and putting it in the list's order is what makes the runner
# execute the rule rather than ask people to remember it. It is a kit check, like
# `repository-checks.sh`, so `.xezar/pipeline/config.json`'s `validation.commands` — the nine npm
# commands a person runs by hand — matches this list in order.
GATE_NAMES=(
  "npm ci"
  ".xezar/checks/security-scan.sh"
  "npm run lint:check"
  "npm run lint:css"
  "npm run design -- --check"
  "npm run typecheck"
  "npm run test:ci"
  "npm run test:cov"
  "npx electron-vite build"
  "npm run check:headers"
  ".xezar/checks/repository-checks.sh"
)
GATE_COMMANDS=(
  "npm ci"
  ".xezar/checks/security-scan.sh"
  "npm run lint:check"
  "npm run lint:css"
  "npm run design -- --check"
  "npm run typecheck"
  "npm run test:ci"
  "npm run test:cov"
  "npx electron-vite build"
  "npm run check:headers"
  ".xezar/checks/repository-checks.sh"
)
# Which application gates may run side by side, as one-based positions in the list above: lanes
# separated by `;`, gates inside a lane by `,` and run in that order. A gate that needs another's
# output (a package test that needs the build) goes after it in the same lane. The committed
# default is validation.applicationLanes in .xezar/pipeline/config.json. An environment override
# still works; an explicitly empty override requests one serial lane.

# The list as JSON, and its digest. Both derived from the arrays above, so they cannot drift
# from what actually runs.
gate_list_json() {
  local i args=()
  for i in "${!GATE_NAMES[@]}"; do args+=("${GATE_NAMES[$i]}" "${GATE_COMMANDS[$i]}"); done
  node -e '
    const argv = process.argv.slice(1);
    const list = [];
    for (let i = 0; i < argv.length; i += 2) list.push({ name: argv[i], command: argv[i + 1] });
    process.stdout.write(JSON.stringify(list));
  ' "${args[@]}"
}
gate_names_json() {
  node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${GATE_NAMES[@]}"
}
gate_list_id() {
  gate_list_json | shasum -a 256 | cut -d' ' -f1
}

FAST=0
LIST=0
AS_JSON=0
PRODUCER=""
# Kept because the parse loop below consumes them and the gate lease re-executes this script
# with exactly what it was called with.
ORIGINAL_ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1 ;;
    --list) LIST=1 ;;
    --json) AS_JSON=1 ;;
    --producer)
      shift
      [ $# -gt 0 ] || { printf 'repo-gates: --producer needs a value (author or gates)\n' >&2; exit 2; }
      PRODUCER="$1"
      ;;
    *)
      printf 'repo-gates: unknown argument "%s"\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done
case "$PRODUCER" in
  "" | author | gates) ;;
  *)
    printf 'repo-gates: --producer must be "author" or "gates", got "%s"\n' "$PRODUCER" >&2
    exit 2
    ;;
esac

if [ "$LIST" -eq 1 ]; then
  if [ "$AS_JSON" -eq 1 ]; then
    node -e '
      process.stdout.write(JSON.stringify({ commandListId: process.argv[1], gates: JSON.parse(process.argv[2]) }));
    ' "$(gate_list_id)" "$(gate_list_json)"
    printf '\n'
  else
    printf 'required gates, in canonical reporting order:\n'
    for i in "${!GATE_NAMES[@]}"; do
      printf '  %-32s %s\n' "${GATE_NAMES[$i]}" "${GATE_COMMANDS[$i]}"
    done
    printf '\ncommandListId  %s\n' "$(gate_list_id)"
  fi
  exit 0
fi

# --- One gate run per machine, by default -----------------------------------------------------
#
# Two full gate runs on one machine starve each other, and they fail in suites the change under
# test never touched. Measured on the engine's own machine: attempt failure was 20% with one
# concurrent run, 37% at three, 90% at four to five and 100% at six or more. Those are that
# machine's numbers on that machine's suite, and the two worst buckets rest on single-digit
# samples - do not quote them as a law. What they establish is the SHAPE: the cliff is steep and
# it arrives early. This kit makes it arrive earlier than most, because one gate run of its own
# already fans out into two application lanes by committed default, so two runs can launch four
# application workers at once.
#
# So the whole run re-executes itself once, holding one of the machine's gate slots. How many run
# together is the engine's `resources.gateSlots`, default 1; the wait is bounded at 20 minutes and
# the engine prints both a notice at 30 seconds and the wait it actually paid.
#
# WHY A RE-EXEC AND NOT A LOCK AROUND THE PHASES. The lease is held for the lifetime of the
# process it wraps, so it is released when this script exits - by any path, including a kill or
# the security stage's early stop. (This file sets `set -uo pipefail` and deliberately not
# `set -e`, so there is no `set -e` abort to be had.) A lock taken inside the script would need an
# EXIT trap to match, and a released-only-on-the-happy-path lease is worse than none: the next run
# on this machine queues behind one that finished minutes ago.
#
# The slot files live at a fixed machine-wide path (`~/.cache/xez/gate-slots/`) in every engine
# layout, so runs in DIFFERENT projects contend against the same slots. That is the point.
#
# FAIL OPEN, ALWAYS - AND THE PROBES ARE WHAT MAKE THAT TRUE. `exec` replaces this script, so
# after it there is no code of ours left to fall back to: every later failure would reach the
# caller AS THE GATE VERDICT, with no gates run and an exit code indistinguishable from a real
# gate failure. So nothing is committed until a probe has proved this binary can actually run the
# verb with the flags used below. From engine 0.19.0 that check is the engine's own published one:
# `lease gates --probe` prints `{"lease":{"gates":true},"slots":<n>}` and exits 0, takes no slot and
# writes no file, and older engines refuse the flag (xezar #866, `862ec8fa`). Before 0.19.0 there is
# no probe, so the old check stays for those engines: `lease gates` with no command after `--` exits
# 2 with a refusal WITHOUT taking a slot, and its `nothing to run` phrase is the one the engine's own
# suite asserts. A fork that does not know the verb, an engine too old for the flags, and an engine
# that dies during boot on a bad setting or a truncated workspace.json all fail both, and we run
# unleased instead. Never match the `usage:` text: the engine declares that wording NOT a contract.
#
# Two fail-open paths are ours and proven here; the other two - an unwritable slot folder and a
# lease that times out - are the engine's contract and are not exercised by this script.
#
# TWO LIMITS THIS SIDE CANNOT CLOSE, written down rather than left to be discovered.
#   - SIGKILL of the WRAPPER does not stop the gates. The engine spawns this script as a child,
#     so killing the engine outright skips its release AND orphans a full gate run: the slot is
#     recovered by pid liveness and handed to a waiter while the orphan is still loading the
#     machine - the very over-subscription the lease exists to prevent. Killing the gate run
#     itself is clean; it is only a kill aimed at the wrapper that leaks. Before the lease the
#     supervisor's direct child WAS this script, so this is a cost the lease introduced.
#   - `XEZ_GATE_LEASE` set in a shell profile or a CI environment disables leasing for every run
#     in that environment. It is a re-entry guard, not a designed opt-out, and the engine states
#     it deliberately offers no env var to turn leasing off.
if [ -z "${XEZ_GATE_LEASE:-}" ]; then
  lease_bin=""
  lease_why=""
  lease_probe=""
  # Ask git for the root. `$SCRIPT_DIR/../..` is only true for the installed `.xezar/checks/`
  # layout; run from the kit source tree it points at the skill folder and probes the wrong
  # node_modules. Git is the fact, the relative path is the fallback when git is absent.
  repo_root="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$repo_root" ] || repo_root="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

  # Every probe is time-bounded. A wedged binary - an NFS stall, a shim waiting on stdin, a node
  # process blocked on a lock - would otherwise hang a command substitution forever, producing no
  # output and no attempt record, and macOS ships no `timeout(1)` to cut it short.
  lease_run_bounded() {
    local secs="$1" out="$2"
    shift 2
    "$@" >"$out" 2>&1 &
    local pid=$! waited=0
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$secs" ]; then
        kill -TERM "$pid" 2>/dev/null
        return 124
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "$pid"
  }

  # A project that depends on the engine gets the exact build it pinned. Rare today - the engine
  # is normally a global install - but it is the strongest identity, so it is tried first.
  if [ -x "$repo_root/node_modules/.bin/xezar" ]; then
    lease_bin="$repo_root/node_modules/.bin/xezar"
  elif command -v xezar >/dev/null 2>&1; then
    lease_bin="$(command -v xezar)"
  elif command -v xez >/dev/null 2>&1; then
    lease_bin="$(command -v xez)"
  else
    lease_why="no xezar on PATH and none in this project's node_modules"
  fi
  # NEVER `npx`: it would fetch some other build from the registry and lease against a different
  # build's idea of the slots. A resolved binary cannot do that.

  if [ -n "$lease_bin" ]; then
    lease_probe="$(mktemp "${TMPDIR:-/tmp}/gate-lease-probe.XXXXXX" 2>/dev/null || true)"
    if [ -z "$lease_probe" ]; then
      lease_why="no temporary file to probe the engine with"
      lease_bin=""
    fi
  fi

  # Probe 1 - the version, compared NUMERICALLY. A glob anchored on `0.` accepts anything that is
  # not `0.<digits>.` from the first character: `v0.16.0`, `0.16` and `0.9` all slipped through it.
  # Requiring three numeric components also rejects a banner-prefixed or truncated version, and
  # anything unparseable is treated as too old.
  lease_has_probe=0
  if [ -n "$lease_bin" ]; then
    if lease_run_bounded 10 "$lease_probe" "$lease_bin" --version; then
      lease_version="$(tr -d '[:space:]' <"$lease_probe")"
    else
      lease_version=""
    fi
    if ! node -e '
      const raw = String(process.argv[1] || "").replace(/^v/, "");
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(raw);
      if (!m) process.exit(1);
      const major = Number(m[1]), minor = Number(m[2]);
      process.exit(major > 0 || (major === 0 && minor >= 17) ? 0 : 1);
    ' "$lease_version" 2>/dev/null; then
      lease_why="engine ${lease_version:-unknown} has no gate lease (it arrived in 0.17.0)"
      lease_bin=""
    elif node -e '
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(process.argv[1] || "").replace(/^v/, ""));
      if (!m) process.exit(1);
      const major = Number(m[1]), minor = Number(m[2]);
      process.exit(major > 0 || (major === 0 && minor >= 19) ? 0 : 1);
    ' "$lease_version" 2>/dev/null; then
      # 0.19.0 and later answer the published `--probe`; older engines refuse the flag.
      lease_has_probe=1
    fi
  fi

  # Probe 2 - the capability, without taking a slot. Two forms, and the engine version above says
  # which one this binary answers.
  #
  # From 0.19.0: `lease gates --probe`, the engine's PUBLISHED check. Exit 0 with
  # `lease.gates === true` in the JSON on stdout means this binary can lease; anything else means it
  # cannot. It runs nothing, takes no slot and writes no file in any layout, and it is answered
  # before the shared parser, so no mode line or first-run import can reach it. Unknown keys are
  # ignored on purpose: the engine may add some.
  #
  # Before 0.19.0 there is no probe, so the old check stays for 0.17 and 0.18: `lease gates` with no
  # command after `--` is refused WITHOUT taking a slot, and the refusal carries `nothing to run` -
  # the one phrase in it the engine's own suite asserts. Exit status is ignored there, because that
  # call is MEANT to fail with 2 and the output is what proves it got as far as the lease command.
  # Never match the `usage:` line in either form: the engine declares that wording not a contract,
  # and a probe that stops matching loses gate serialisation for every onboarded project SILENTLY -
  # no error, no slower run anyone notices, just contention coming back.
  if [ -n "$lease_bin" ]; then
    if [ "$lease_has_probe" -eq 1 ]; then
      if lease_run_bounded 20 "$lease_probe" "$lease_bin" lease gates --probe; then
        node -e '
          const fs = require("node:fs");
          let answer;
          try { answer = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
          process.exit(answer && answer.lease && answer.lease.gates === true ? 0 : 1);
        ' "$lease_probe" 2>/dev/null || {
          lease_why="the engine at $lease_bin answers \`lease gates --probe\` without lease.gates true"
          lease_bin=""
        }
      else
        lease_why="the engine at $lease_bin cannot run \`lease gates --probe\`"
        lease_bin=""
      fi
    else
      lease_run_bounded 20 "$lease_probe" "$lease_bin" lease gates --status-file "$lease_probe.status"
      if ! grep -qF 'nothing to run' "$lease_probe" 2>/dev/null; then
        lease_why="the engine at $lease_bin cannot run \`lease gates --status-file\`"
        lease_bin=""
      fi
      rm -f "$lease_probe.status" 2>/dev/null
    fi
  fi

  if [ -n "$lease_bin" ]; then
    rm -f "$lease_probe" 2>/dev/null
    # The child reads this to report what the wait actually cost and to record `leaseWaitMs` on
    # the attempt. Without it the one residual risk the engine documents - a step killed mid-wait
    # - is invisible afterwards.
    lease_status="$(mktemp "${TMPDIR:-/tmp}/gate-lease-status.XXXXXX" 2>/dev/null || true)"
    export XEZ_GATE_LEASE=1
    export XEZ_GATE_LEASE_STATUS="$lease_status"
    # `bash` and an ABSOLUTE path, both deliberate: the engine spawns the wrapped command without
    # a shell, so a relative `repo-gates.sh` is not resolvable and the exec bit is not guaranteed.
    # The `+` form keeps an empty array from tripping `set -u` on older bash.
    # `execfail` is what keeps the promise above: without it a failed `exec` exits this
    # non-interactive shell outright and the fail-open line below is unreachable.
    shopt -s execfail
    exec "$lease_bin" lease gates ${lease_status:+--status-file "$lease_status"} \
      -- bash "$SCRIPT_DIR/repo-gates.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
    # Reached only when `exec` itself failed - the binary passed every probe and then could not be
    # started: deleted or replaced in the meantime, a `noexec` mount, ETXTBSY.
    shopt -u execfail
    unset XEZ_GATE_LEASE XEZ_GATE_LEASE_STATUS
    rm -f "$lease_status" 2>/dev/null
    lease_why="the engine passed every probe and then could not be started"
  else
    rm -f "$lease_probe" 2>/dev/null
  fi
  printf 'gate lease     NOT TAKEN (%s) - running unleased\n' "$lease_why" >&2
fi

# What the lease cost, reported by the child of the re-exec. A genuinely nested gate run - one
# spawned from inside a gate command - inherits the same variables and prints the same line, which
# is accurate: it really is running under a slot an ancestor holds. Silence here was the old
# behaviour and was indistinguishable from "no lease at all".
GATE_LEASE_WAIT_MS=""
if [ -n "${XEZ_GATE_LEASE_STATUS:-}" ] && [ -s "${XEZ_GATE_LEASE_STATUS:-}" ]; then
  # The human line goes to stderr so it is seen; the number goes to stdout so it is captured.
  GATE_LEASE_WAIT_MS="$(node -e '
    try {
      const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (s && s.held === true && Number.isFinite(s.waitedMs)) {
        // Same wording as the engine own message, and NOT re-indexed: the engine reports the
        // slot as it numbers it, so adding one here made the two disagree ("slot 2 of 1").
        process.stderr.write(`gate lease     HELD (slot ${s.slot} of ${s.slots}, waited ${(s.waitedMs / 1000).toFixed(1)}s)\n`);
        process.stdout.write(String(s.waitedMs));
      }
    } catch { /* diagnostics, never the lease */ }
  ' "$XEZ_GATE_LEASE_STATUS")"
fi
export GATE_LEASE_WAIT_MS

resolve_task_paths || exit 1
cd "$TASK_CWD" || exit 1

# Who produced this attempt (#676 PR 2). The flag is the workflow's own declaration; without it
# the producer is the AUTHOR, and `lib/gate-results.mjs` refuses to seal an author's attempt.
# `gate_resolve_producer` (lib/gate-record.sh) owns the resolution, including the one-release
# migration for a run whose persisted definition predates the flag.
GATE_PRODUCER="$(gate_resolve_producer "$PRODUCER")"
export GATE_PRODUCER

# Units mode (`dependencies.units`, read from the base branch by lib/deps.mjs): the install gate is
# deps-restore.sh, the one install entry point worktree-setup.sh also runs. Any other first gate
# would install something other than what setup and the freshness stamps describe.
deps_units_mode
DEPS_UNITS=$?
if [ "$DEPS_UNITS" -eq 2 ]; then
  printf '\nGATES ABORTED: dependencies.units was refused (reason above), so nothing could be installed and nothing here could be evidence.\n' >&2
  exit 1
fi
if [ "$DEPS_UNITS" -eq 0 ] && [ "${GATE_COMMANDS[0]}" != ".xezar/checks/deps-restore.sh" ]; then
  printf '\nGATES ABORTED: dependencies.units is set, so the first gate must be .xezar/checks/deps-restore.sh, and it is "%s".\n' "${GATE_COMMANDS[0]}" >&2
  exit 1
fi

if [ "$FAST" -eq 1 ] && ! deps_are_fresh; then
  printf '=== --fast declined ===\n'
  if [ "$DEPS_UNITS" -eq 0 ]; then
    printf 'The installed dependencies do not match the lockfiles and manifests of every unit in dependencies.units.\n'
    printf 'Installing anyway: a gate run against a stale install is not evidence.\n'
  else
    printf 'The installed dependencies do not match package-lock.json / the workspace package.json files.\n'
    printf 'Installing anyway: a gate run against a stale node_modules is not evidence.\n'
  fi
  FAST=0
fi

# Base identity for the record. Resolved the same way `worktree-setup.sh` does it.
GATE_BASE_REF="origin/$BASE_BRANCH"
git rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH" >/dev/null 2>&1 || GATE_BASE_REF="$BASE_BRANCH"
GATE_BASE_SHA="$(git merge-base HEAD "$GATE_BASE_REF" 2>/dev/null || printf '')"
export GATE_BASE_REF GATE_BASE_SHA

# Resolve the exact application schedule before starting the attempt. The scheduler's own
# parser validates both the committed default and any environment override; the same resolved
# lanes are recorded in attempt.json and carried into result.json.
GATE_LAST=${#GATE_NAMES[@]}
GATE_APPLICATION=()
gate_schedule_args=()
for ((gate_i = 3; gate_i < GATE_LAST; gate_i++)); do
  GATE_APPLICATION+=("$gate_i")
  gate_schedule_args+=("$gate_i" "${GATE_NAMES[$((gate_i - 1))]}" "${GATE_COMMANDS[$((gate_i - 1))]}")
done
if [ "${#GATE_APPLICATION[@]}" -gt 0 ]; then
  gate_schedule_entries="$(node -e '
    const args = process.argv.slice(1), entries = [];
    for (let i = 0; i < args.length; i += 3) entries.push({index: Number(args[i]), name: args[i+1], command: args[i+2]});
    process.stdout.write(JSON.stringify(entries));
  ' "${gate_schedule_args[@]}")" || exit 1
  GATE_APPLICATION_SCHEDULE_JSON="$(node "$SCRIPT_DIR/lib/gate-parallel.mjs" --describe "$gate_schedule_entries")" || exit 1
else
  GATE_APPLICATION_SCHEDULE_JSON='null'
fi
export GATE_APPLICATION_SCHEDULE_JSON

printf '=== repo gates ===\n'
printf 'producer       %s\n' "$GATE_PRODUCER"
printf 'application    %s\n' "$GATE_APPLICATION_SCHEDULE_JSON"
if ! gate_attempt_begin "$(gate_names_json)" "$(gate_list_id)"; then
  printf '\nGATES ABORTED: the attempt could not be recorded, so nothing here could become evidence.\n' >&2
  exit 1
fi

# Only this shell reduces results; workers own separate files and process groups.
# All command phases use the same supervisor, including install and the repository-check tail.
export GATE_RESULTS_MJS GATE_ATTEMPT_ID GATE_ATTEMPT_DIR GATE_LOG_DIR
GATE_SCHEDULER_PID=""
gate_cancel() {
  trap '' INT TERM
  if [ -n "$GATE_SCHEDULER_PID" ]; then
    kill -TERM "$GATE_SCHEDULER_PID" 2>/dev/null || true
    wait "$GATE_SCHEDULER_PID" 2>/dev/null || true
  fi
  if [ -f "$GATE_ATTEMPT_DIR/result.json" ]; then
    printf '\nGATES INTERRUPTED: finalization produced a completed record; retained at %s/result.json.\n' "$GATE_ATTEMPT_DIR" >&2
  else
    printf '\nGATES INTERRUPTED: retained attempt is incomplete.\n' >&2
  fi
  exit 130
}
trap gate_cancel INT TERM

gate_phase() {
  local mode="$1"; shift
  local index entries args=()
  for index in "$@"; do
    args+=("$index" "${GATE_NAMES[$((index - 1))]}" "${GATE_COMMANDS[$((index - 1))]}")
  done
  entries="$(node -e '
    const args = process.argv.slice(1), entries = [];
    for (let i = 0; i < args.length; i += 3) entries.push({index: Number(args[i]), name: args[i+1], command: args[i+2]});
    process.stdout.write(JSON.stringify(entries));
  ' "${args[@]}")" || return 1
  node "$SCRIPT_DIR/lib/gate-parallel.mjs" "$SCRIPT_DIR/lib/gate-record.sh" "$mode" "$entries" &
  GATE_SCHEDULER_PID=$!
  wait "$GATE_SCHEDULER_PID"
  local scheduler_rc=$?
  GATE_SCHEDULER_PID=""
  # A failed supervisor/reducer leaves no result.json, even if every tool exited zero.
  [ "$scheduler_rc" -eq 0 ] || return 1
  for index in "$@"; do
    gate_collect_worker "$index" "${GATE_NAMES[$((index - 1))]}" "${GATE_COMMANDS[$((index - 1))]}" || return 1
  done
}

# Publish the attempt and end the run with its verdict. Extracted so the security stage's early
# stop goes through the SAME completion path as a full run: an attempt is never left green and
# never left half-written, whatever ended it.
#
# `expected` is the outcome THIS caller already knows the run must end with — `passed` at the end
# of a full run, `failed` from the security stop. The completer's return code can only CONFIRM
# that outcome: a completer that returned 0 for an attempt this caller knows was refused must not
# print a pass or exit 0. The argument is therefore REQUIRED and has no default, so a future
# caller that forgets it fails closed — an empty outcome never equals `passed` (#691).
gate_finish() {
  local expected="$1"
  printf '\n==================== SUMMARY ====================\n'
  # Publishing result.json is the completion commit point. Bash may defer a signal
  # during finalization; the trap then reports the completed record instead of denying it.
  result="$(gate_attempt_complete)"
  complete_rc=$?
  printf 'attempt        %s\n' "$GATE_ATTEMPT_ID"
  printf 'record         %s/result.json\n' "$GATE_ATTEMPT_DIR"
  printf 'recorded       %s\n' "$result"

  if [ "$complete_rc" -eq 0 ] && [ "$expected" = passed ]; then
    printf 'ALL GATES PASSED\n'
    exit 0
  fi
  # The record can refuse an attempt the loop above thought was clean — a broken log, or a gate
  # with no recorded outcome at all. That disagreement is itself the failure.
  [ "$complete_rc" -eq 0 ] || printf 'The recorded result is "%s" — this attempt cannot be sealed.\n' "$result"
  exit 1
}

if [ "$FAST" -eq 1 ]; then
  # Recorded under the install gate's own name: the seal looks each required gate up by name, and
  # gate-results.mjs is told that name by its caller, never by the record it judges.
  gate_note_skip "${GATE_NAMES[0]}" "deps-verified-current" || exit 1
else
  gate_phase serial 1 || exit 1
  if node -e 'process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1])).status === "passed" ? 0 : 1)' "$GATE_ATTEMPT_DIR/workers/1.json"; then
    # A passed install whose workspace packages still load from another checkout would have
    # every later gate judge that checkout's source (#286). No command after this point could
    # produce evidence for this branch, so the attempt stops here and is left incomplete.
    # (--fast reaches this line only through deps_are_fresh, which applies the same check.)
    if ! deps_resolve_in_task; then
      if [ "$DEPS_UNITS" -eq 0 ]; then
        printf '\nGATES ABORTED: dependencies are missing or resolve outside this task; nothing here could be evidence for it.\n' >&2
      else
        printf '\nGATES ABORTED: workspace packages resolve outside this task; nothing here could be evidence for it.\n' >&2
      fi
      exit 1
    fi
    write_deps_stamp || exit 1
  fi
fi
# Security first, alone, and before any quality gate. A failing security stage stops the run
# here: there is no point paying for a build to find out what the scan already refused, and a
# quality verdict given ahead of the security result is the order this exists to prevent.
#
# `gate_phase` returns non-zero only for an INFRASTRUCTURE failure — a non-zero scheduler, or a
# worker whose result could not be collected. A security gate that RAN and refused the candidate
# exits 1 and records `failed`, and the phase still returns 0, so this stage used to fall
# straight through to the five quality gates (#680). The stage's own recorded outcome is the
# boundary that was missing.
#
# This arm reads the GATE-WORKER vocabulary, which is all `workers/2.json` ever carries:
# `gate_collect_worker` validates that file to exactly `passed` / `failed` / `not-run`, so `passed`
# is the only value that continues and `failed` and `not-run` both stop. The security-result
# vocabulary (`pass` / `findings` / `unknown` / `not-applicable`) lives in `security.json` and must
# never be read here: `pass` is one letter from `passed`, so a "more accurate" re-point would stop
# every clean run. `unknown` deliberately does not stop the run — it is a resolved security
# outcome, not a refusal, and `security-scan.sh` exits 0 for it (#691).
gate_phase serial 2 || exit 1
security_status="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).status)' "$GATE_ATTEMPT_DIR/workers/2.json" 2>/dev/null)" || security_status="unreadable"
case "$security_status" in
  passed) ;;
  *)
    printf '\nGATES STOPPED AT THE SECURITY STAGE: the security gate recorded "%s", so no quality gate ran.\n' "$security_status"
    printf 'Security is resolved before any quality verdict, and the attempt is completed as failed.\n'
    gate_finish failed
    ;;
esac
# The phases are derived from the list, never numbered by hand: gate 1 is the install, gate 2 the
# security stage, the LAST gate the repository-check tail, and everything between is the
# application phase. A project with five application gates or nine gets the same three lines.
if [ "${#GATE_APPLICATION[@]}" -gt 0 ]; then
  gate_phase application "${GATE_APPLICATION[@]}" || exit 1
fi
gate_phase serial "$GATE_LAST" || exit 1
gate_finish passed
