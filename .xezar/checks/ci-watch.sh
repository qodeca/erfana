#!/usr/bin/env bash
# Observe ONE already-identified CI run on the base branch, under a deadline of its own.
#
# WHAT THIS IS FOR. The integration role used to do this waiting inside its agent turn: the
# session stayed open, tokens were spent on a loop that needs no judgement, and nothing bounded
# it. The observation itself is a command that ends when CI ends, so it belongs in a check step —
# The engine's `runCheckStep` spawns a check with no agent session and
# no tokens. It still runs inside the run's own slot (`run.ts:3735`), so what is saved is tokens,
# a parked session and an unbounded wait; a workspace slot is NOT freed.
#
# WHAT IT DOES NOT DO. It never merges, never pushes, never reruns a job and never writes to
# GitHub. It reads one run and records what it saw. Every decision that follows — revert or
# forward-fix; rerunning is not among them — belongs to the agent step after it, which is where
# `XEZ:ASK` is still live and where the leader's `execution_control` `send_message` can reach a
# session at all.
#
# THE BOUND LIVES HERE. A check step may not carry `timeout` (`workflows/types.ts`, the refine
# beside `stepTimeoutSchema` refuses it), so the wall clock is this script's own: `--deadline`,
# 45 minutes by default. `timeout(1)` does not exist on macOS, so the bound is a poll loop over a
# child PID we started ourselves. Nothing here is killed by command-line pattern: `pkill -f` would
# match every peer agent on this machine (see `.xezar/CLAUDE.md`).
#
# THE INPUT. The merge step records its target as JSON under the task's evidence directory:
#
#   <evidence>/ci-watch/target.json
#   {"runId":"35369683346","repo":"owner/name","base":"main","mergeSha":"<40 hex>","pr":661}
#
# `mergeSha` and `pr` are optional context carried into the outcome record. A missing, unreadable,
# malformed or out-of-shape target is a REFUSAL, not a guess: this script never discovers a run id
# for itself, because guessing one is how a merge gets judged by somebody else's CI run.
#
# THE OUTPUT. `<evidence>/ci-watch/outcome.json`, plus a human-readable verdict on stdout. The
# outcome carries the observed conclusion verbatim, so the agent after it reads a fact rather than
# this script's opinion of one.
#
# EXIT CODES, AND THE ONE PLACE THE POLICY LIVES (`exit_for_outcome` at the bottom).
#   0  success           CI finished green
#   0  cancelled         CI was cancelled — usually superseded by a later push; see supersededBy
#   0  failure           CI finished red, observed and recorded; the agent step adjudicates
#   2  target.missing / target.invalid
#   3  unobservable      `gh` could not answer, or the run is not in a terminal state
#   4  deadline          the observation window elapsed with the run still going
#
# A red CI exits 0 ON PURPOSE, and this is the one place this script departs from the brief that
# asked for it. A non-zero check step with no `onFail` ends the run (`run.ts`, the break after
# `finishStep(... 'failed' ...)`), so exiting non-zero on red would mean the report step never
# runs: no adjudication, no `XEZ:ASK`, no question to the leader at the only moment
# integration ever needs one — and `onFail.retry` cannot help, because every step earlier than
# this one is earlier than the merge, so retrying would re-run the merge. Red is therefore
# OBSERVED (exit 0, outcome `failure`) and judged by the agent; unobservable and out-of-time are
# the failures, because those are the states in which there is nothing to report.
#
# GitHub is reached through one indirection, `$KIT_TEST_GH` (default `gh`), so the boundary can be
# driven by a stub in `infra-tests.sh`. There is no other network call in this file.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

GH="${KIT_TEST_GH:-gh}"

# 45 minutes. The campaign's median `main` CI run was 12 minutes and its longest observed wait 47;
# the point of a bound is not to be generous, it is to end.
DEADLINE_SECONDS=2700
POLL_SECONDS=10

usage() {
  cat <<'EOF'
usage: ci-watch.sh [--deadline <seconds>] [--poll <seconds>]

Reads <evidence>/ci-watch/target.json, watches that one CI run to a terminal state or to the
deadline, and records <evidence>/ci-watch/outcome.json. Read-only against GitHub.

  --deadline  the observation window in whole seconds (default 2700 — 45 minutes)
  --poll      how often the deadline is re-checked, in whole seconds (default 10)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deadline) DEADLINE_SECONDS="${2:-}"; shift 2 ;;
    --poll) POLL_SECONDS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'ci-watch: unknown argument "%s"\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

for pair in "deadline:$DEADLINE_SECONDS" "poll:$POLL_SECONDS"; do
  case "${pair#*:}" in
    ''|*[!0-9]*|0) printf 'ci-watch: --%s must be a positive whole number of seconds\n' "${pair%%:*}" >&2; exit 2 ;;
  esac
done

# --- Identity and the evidence directory -------------------------------------------------------
# A check step is spawned with the manager's environment, which has no XEZ_TASK_ID, so identity
# comes from the worktree directory name exactly as it does for every other check here.
if ! resolve_task_paths; then
  printf 'ci-watch: this is not a git checkout Xezar can identify\n' >&2
  exit 2
fi
if [ -z "${TASK_ID:-}" ]; then
  printf 'ci-watch: no task identity — run this from the task worktree Xezar created\n' >&2
  exit 2
fi
EVIDENCE_DIR="$(task_evidence_dir)" || { printf 'ci-watch: could not resolve the evidence directory\n' >&2; exit 2; }
WATCH_DIR="$EVIDENCE_DIR/ci-watch"
TARGET="$WATCH_DIR/target.json"
OUTCOME="$WATCH_DIR/outcome.json"

# --- The outcome record -------------------------------------------------------------------------
# Written through node so every value is escaped, and written for EVERY exit path including the
# refusals: "nothing was recorded" and "the wait produced nothing" must not look the same to the
# agent step that reads this next.
OUT_RUN_ID="" OUT_REPO="" OUT_BASE="" OUT_MERGE_SHA="" OUT_PR=""
OUT_STATUS="" OUT_CONCLUSION="" OUT_HEAD_SHA="" OUT_URL=""
OUT_FAILED_JOBS="" OUT_SUPERSEDED_SHA="" OUT_SUPERSEDED_RUN=""
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

record_outcome() {
  local outcome="$1" detail="$2"
  mkdir -p "$WATCH_DIR" 2>/dev/null
  OUTCOME_JSON_OK=1
  node -e '
    const [file, outcome, detail, runId, repo, base, mergeSha, pr, status, conclusion,
           headSha, url, failedJobs, supersededSha, supersededRun, startedAt,
           deadline] = process.argv.slice(1);
    const list = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const failed = list(failedJobs);
    const body = {
      outcome,
      detail,
      runId: runId || null,
      repo: repo || null,
      base: base || null,
      mergeSha: mergeSha || null,
      pr: pr ? Number(pr) : null,
      status: status || null,
      conclusion: conclusion || null,
      headSha: headSha || null,
      url: url || null,
      failedJobs: failed,
      supersededBy: supersededSha ? { headSha: supersededSha, runId: supersededRun || null } : null,
      observedFrom: startedAt,
      observedTo: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      deadlineSeconds: Number(deadline),
    };
    require("node:fs").writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  ' "$OUTCOME" "$outcome" "$detail" "$OUT_RUN_ID" "$OUT_REPO" "$OUT_BASE" "$OUT_MERGE_SHA" \
    "$OUT_PR" "$OUT_STATUS" "$OUT_CONCLUSION" "$OUT_HEAD_SHA" "$OUT_URL" "$OUT_FAILED_JOBS" \
    "$OUT_SUPERSEDED_SHA" "$OUT_SUPERSEDED_RUN" "$STARTED_AT" \
    "$DEADLINE_SECONDS" 2>/dev/null || OUTCOME_JSON_OK=0
  if [ "$OUTCOME_JSON_OK" -eq 0 ]; then
    printf 'ci-watch: WARNING — could not write %s; the verdict below is the only record\n' "$OUTCOME" >&2
  fi
}

# The single place the exit policy lives. Read the header before changing a row.
exit_for_outcome() {
  case "$1" in
    success|cancelled|failure) return 0 ;;
    target.missing|target.invalid) return 2 ;;
    unobservable) return 3 ;;
    deadline) if [ "${TARGET_KIND:-integration}" = "deploy" ]; then return 0; fi; return 4 ;;
    *) return 3 ;;
  esac
}

finish() {
  local outcome="$1" detail="$2"
  record_outcome "$outcome" "$detail"
  printf '\nci-watch: [%s] %s\n' "$outcome" "$detail"
  [ -n "$OUT_RUN_ID" ] && printf '  run %s on %s (%s)\n' "$OUT_RUN_ID" "${OUT_REPO:-unknown}" "${OUT_URL:-no url}"
  [ -n "$OUT_STATUS" ] && printf '  status %s, conclusion %s\n' "$OUT_STATUS" "${OUT_CONCLUSION:-none}"
  [ -n "$OUT_FAILED_JOBS" ] && printf '  failed jobs: %s\n' "$(printf '%s' "$OUT_FAILED_JOBS" | tr '\n' ',' | sed 's/,$//')"
  [ -n "$OUT_SUPERSEDED_SHA" ] && printf '  superseded by %s (run %s)\n' "$OUT_SUPERSEDED_SHA" "${OUT_SUPERSEDED_RUN:-unknown}"
  printf '  record: %s\n' "$OUTCOME"
  exit_for_outcome "$outcome"
  exit $?
}

# --- The target -----------------------------------------------------------------------------------
[ -r "$TARGET" ] || finish "target.missing" "no target at $TARGET — the merge step records the run id it produced, and this script never guesses one"

TARGET_FIELDS="$(node -e '
  const fs = require("node:fs");
  let t;
  try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
  if (t === null || typeof t !== "object" || Array.isArray(t)) process.exit(3);
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  process.stdout.write([str(t.runId), str(t.repo), str(t.base), str(t.mergeSha), str(t.pr), str(t.kind)].join("\n"));
' "$TARGET" 2>/dev/null)" || finish "target.invalid" "$TARGET is not a JSON object this script can read"

OUT_RUN_ID="$(printf '%s' "$TARGET_FIELDS" | sed -n '1p')"
OUT_REPO="$(printf '%s' "$TARGET_FIELDS" | sed -n '2p')"
OUT_BASE="$(printf '%s' "$TARGET_FIELDS" | sed -n '3p')"
OUT_MERGE_SHA="$(printf '%s' "$TARGET_FIELDS" | sed -n '4p')"
OUT_PR="$(printf '%s' "$TARGET_FIELDS" | sed -n '5p')"
# `kind` is absent for the run a merge produced. "deploy" is a run the deploy role dispatched,
# and two things that are true of a CI run are false of it: a newer push to the base branch
# does not "supersede" a deploy somebody cancelled; and running out of time must still reach the
# report step, because a deploy still in flight with nobody told is the worst way for this window
# to end.
TARGET_KIND="$(printf '%s' "$TARGET_FIELDS" | sed -n '6p')"
case "$TARGET_KIND" in
  ''|integration) TARGET_KIND="integration" ;;
  deploy) ;;
  *) finish "target.invalid" "kind \"$TARGET_KIND\" is neither integration nor deploy" ;;
esac

# Identifiers are validated, never sanitised: a value that is not the shape it claims to be is a
# refusal. These strings become arguments to `gh`.
printf '%s' "$OUT_RUN_ID" | grep -Eq '^[0-9]{1,20}$' \
  || finish "target.invalid" "runId \"$OUT_RUN_ID\" is not a GitHub run id"
printf '%s' "$OUT_REPO" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' \
  || finish "target.invalid" "repo \"$OUT_REPO\" is not owner/name"
printf '%s' "$OUT_BASE" | grep -Eq '^[A-Za-z0-9._/-]{1,255}$' \
  || finish "target.invalid" "base \"$OUT_BASE\" is not a branch name"
if [ -n "$OUT_MERGE_SHA" ] && ! printf '%s' "$OUT_MERGE_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  finish "target.invalid" "mergeSha \"$OUT_MERGE_SHA\" is not a full 40-character SHA"
fi
if [ -n "$OUT_PR" ] && ! printf '%s' "$OUT_PR" | grep -Eq '^[0-9]{1,10}$'; then
  finish "target.invalid" "pr \"$OUT_PR\" is not a pull request number"
fi

command -v "$GH" >/dev/null 2>&1 \
  || finish "unobservable" "\`$GH\` is not on PATH — an observation that cannot be made is not a pass"

mkdir -p "$WATCH_DIR" 2>/dev/null
LOG="$WATCH_DIR/watch.log"

printf 'ci-watch: watching run %s on %s (%s), deadline %ss\n' "$OUT_RUN_ID" "$OUT_REPO" "$OUT_BASE" "$DEADLINE_SECONDS"

# --- The bounded wait --------------------------------------------------------------------------
# `gh run watch --exit-status` is the long-running half. It is started as OUR OWN child, its pid is
# kept, and that pid is what gets signalled if the deadline lands first. Never a pattern.
"$GH" run watch "$OUT_RUN_ID" --repo "$OUT_REPO" --exit-status >"$LOG" 2>&1 &
WATCH_PID=$!
DEADLINE_AT=$(( $(date +%s) + DEADLINE_SECONDS ))
TIMED_OUT=0
while kill -0 "$WATCH_PID" 2>/dev/null; do
  if [ "$(date +%s)" -ge "$DEADLINE_AT" ]; then
    TIMED_OUT=1
    kill "$WATCH_PID" 2>/dev/null
    # One grace period, then insist. Still by pid.
    sleep 2
    kill -0 "$WATCH_PID" 2>/dev/null && kill -9 "$WATCH_PID" 2>/dev/null
    break
  fi
  sleep "$POLL_SECONDS"
done
wait "$WATCH_PID" 2>/dev/null
WATCH_STATUS=$?

# --- What GitHub actually says -------------------------------------------------------------------
# The watch exit code is not the record. `--exit-status` reports red and green, but it does not
# separate a cancelled run from a failed one, and that distinction is the whole point of the
# cancelled case: a later push cancelling an in-flight run is normal here, not a regression.
VIEW="$("$GH" run view "$OUT_RUN_ID" --repo "$OUT_REPO" \
  --json status,conclusion,headSha,url,createdAt,jobs 2>&1)" || VIEW=""
if [ -z "$VIEW" ]; then
  finish "unobservable" "\`gh run view $OUT_RUN_ID\` did not answer (watch exited $WATCH_STATUS); could not ask is never a pass"
fi

VIEW_FIELDS="$(printf '%s' "$VIEW" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let v;
    try { v = JSON.parse(raw); } catch { process.exit(3); }
    if (v === null || typeof v !== "object") process.exit(3);
    const jobs = Array.isArray(v.jobs) ? v.jobs : [];
    const failed = jobs
      .filter((j) => ["failure", "timed_out", "startup_failure"].includes(String(j?.conclusion)))
      .map((j) => String(j?.name ?? "").trim())
      .filter(Boolean);
    const str = (x) => (x === undefined || x === null ? "" : String(x));
    process.stdout.write([str(v.status), str(v.conclusion), str(v.headSha), str(v.url),
      str(v.createdAt), failed.join("\u001f")].join("\n"));
  });
' 2>/dev/null)" || finish "unobservable" "\`gh run view $OUT_RUN_ID\` answered something this script cannot read"

OUT_STATUS="$(printf '%s' "$VIEW_FIELDS" | sed -n '1p')"
OUT_CONCLUSION="$(printf '%s' "$VIEW_FIELDS" | sed -n '2p')"
OUT_HEAD_SHA="$(printf '%s' "$VIEW_FIELDS" | sed -n '3p')"
OUT_URL="$(printf '%s' "$VIEW_FIELDS" | sed -n '4p')"
RUN_CREATED_AT="$(printf '%s' "$VIEW_FIELDS" | sed -n '5p')"
OUT_FAILED_JOBS="$(printf '%s' "$VIEW_FIELDS" | sed -n '6p' | tr '\037' '\n')"

[ -n "$OUT_STATUS" ] || finish "unobservable" "\`gh run view $OUT_RUN_ID\` returned no status"

if [ "$TIMED_OUT" -eq 1 ] && [ "$OUT_STATUS" != "completed" ]; then
  finish "deadline" "the ${DEADLINE_SECONDS}s observation window elapsed with run $OUT_RUN_ID still $OUT_STATUS — bounded, not failed; decide in the next step"
fi
if [ "$OUT_STATUS" != "completed" ]; then
  finish "unobservable" "the watch ended (exit $WATCH_STATUS) but run $OUT_RUN_ID is $OUT_STATUS, not a terminal state"
fi

case "$OUT_CONCLUSION" in
  success)
    finish "success" "run $OUT_RUN_ID finished green on $OUT_BASE"
    ;;
  cancelled)
    if [ "$TARGET_KIND" = "deploy" ]; then
      finish "cancelled" "deploy run $OUT_RUN_ID was cancelled — observed; whatever it had already changed is still changed"
    fi
    # Usually a later push cancelled it through the concurrency group. Say what superseded it, or
    # say plainly that nothing newer was found — "cancelled" and "superseded" are not synonyms.
    SUPER="$("$GH" run list --repo "$OUT_REPO" --branch "$OUT_BASE" --limit 20 \
      --json databaseId,headSha,createdAt 2>/dev/null)" || SUPER=""
    if [ -n "$SUPER" ]; then
      SUPER_FIELDS="$(printf '%s' "$SUPER" | node -e '
        let raw = "";
        process.stdin.on("data", (d) => (raw += d));
        process.stdin.on("end", () => {
          let rows;
          try { rows = JSON.parse(raw); } catch { process.exit(0); }
          if (!Array.isArray(rows)) process.exit(0);
          const [ourId, ourSha, ourCreated] = process.argv.slice(1);
          const newer = rows
            .filter((r) => String(r?.databaseId) !== ourId && String(r?.headSha ?? "") !== ourSha)
            .filter((r) => !ourCreated || String(r?.createdAt ?? "") > ourCreated)
            .sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")))[0];
          if (!newer) process.exit(0);
          process.stdout.write([String(newer.headSha ?? ""), String(newer.databaseId ?? "")].join("\n"));
        });
      ' "$OUT_RUN_ID" "$OUT_HEAD_SHA" "$RUN_CREATED_AT" 2>/dev/null)" || SUPER_FIELDS=""
      OUT_SUPERSEDED_SHA="$(printf '%s' "$SUPER_FIELDS" | sed -n '1p')"
      OUT_SUPERSEDED_RUN="$(printf '%s' "$SUPER_FIELDS" | sed -n '2p')"
    fi
    if [ -n "$OUT_SUPERSEDED_SHA" ]; then
      finish "cancelled" "run $OUT_RUN_ID was cancelled, superseded by $OUT_SUPERSEDED_SHA — observed, not a failure"
    fi
    finish "cancelled" "run $OUT_RUN_ID was cancelled and no newer run on $OUT_BASE was found — observed, not a failure, and not proved superseded either"
    ;;
  failure|timed_out|startup_failure)
    finish "failure" "run $OUT_RUN_ID concluded $OUT_CONCLUSION on $OUT_BASE — observed and recorded; the report step adjudicates"
    ;;
  *)
    finish "unobservable" "run $OUT_RUN_ID concluded \"${OUT_CONCLUSION:-none}\", which is neither green, red nor cancelled"
    ;;
esac
