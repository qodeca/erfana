#!/usr/bin/env bash
# The phase record, as a command instead of a page people are asked to remember.
#
# `SDLC.md` § Task phases says what each phase settles and `.xezar/docs/phase-record.md` says
# what it writes down. Until this file both were prose: the records were named, nothing created
# them, and nothing noticed when a phase left none. A disposition nobody wrote is
# indistinguishable from a phase nobody ran, which is the `phase-hole` failure this closes.
#
# Everything lives in the PRIMARY checkout's `.local/xezar/tasks/<runId>/`, resolved through
# `lib/common.sh` — never the task worktree's own `.local/xezar/`, which retention reclaims.
#
# Usage:
#   phase-record.sh set <NAME> [<text>]      write a record (text, or stdin when omitted)
#   phase-record.sh get <NAME>               print one record
#   phase-record.sh list                     list the records this run has written
#   phase-record.sh check [--predicates]     validate the records readiness requires
#   phase-record.sh counters                 print the three repair counters and what is left
#   phase-record.sh counters init --none | --predecessor <runId>
#                                            declare the counter history before any repair
#   phase-record.sh counter <kind> --trigger <text> [--dry-run]
#                                            consume one round of a counter, BEFORE applying it
#
#   <kind> is one of: self-review | gate-return | quality-repair
#
# Exit 0 on success, 1 on a refusal, 2 on usage.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

# --- The records readiness requires ---------------------------------------------------------
#
# Data, not control flow. Each entry is `NAME|predicate|what it must say`, and the list is
# scoped to the phases that have already run by the time readiness does — a read-only role never
# reaches readiness at all, so nothing here asks a reviewer for an author's facts.
REQUIRED_AT_READINESS=(
  "CAPABILITY|phase.capability|which backends, tools, networks and scanners were actually available, and which required one is absent"
  "DEPTH|phase.depth|small, standard or high-risk, and the one sentence that chose it"
  "MATURITY|phase.maturity|where the inputs sit on the ladder, and which required input is missing or stale"
  "CRITERIA|phase.criteria|each accepted acceptance criterion with its ID, and the authority that accepted it"
  "PLAN|phase.plan|files and contracts in scope, how each criterion will be proven, and the plan-review outcome"
  "SELF_REVIEW|phase.self-review|each self-review round, or that none was needed"
  "DOCS|phase.docs|the documentation applicability decision, and which documents changed"
  "COUNTERS|phase.counters|the repair-counter history, declared before any repair (phase-record.sh counters init)"
)

# The three durable counters. None substitutes for another (SDLC.md § Self-review inside the
# author phase, and the repair counters).
COUNTER_KINDS="self-review gate-return quality-repair"
COUNTER_LIMIT=2

usage() {
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
}

die() { printf 'phase-record: %s\n' "$*" >&2; exit 2; }
refuse() { printf 'phase-record: %s\n' "$*" >&2; exit 1; }

# A record name is a file name in a directory this run owns. Validate it rather than trusting a
# caller: `../` or an absolute path would write somewhere else entirely.
valid_record_name() {
  printf '%s' "$1" | grep -Eq '^[A-Z][A-Z0-9_]{0,31}$'
}

# Resolved in THIS shell, not a subshell: the identity variables the rest of the script reads
# (`TASK_ID`, `MAIN_ROOT`) die with a command substitution, and `list` used to print a bare
# "unbound variable" instead of a record.
resolve_task_paths >/dev/null 2>&1 || true
if [ -z "${TASK_ID:-}" ] || ! DIR="$(task_evidence_dir)"; then
  printf 'phase-record: the run id could not be determined, so this task has no evidence directory.\n' >&2
  printf '              Run this from the task worktree xezar created.\n' >&2
  exit 1
fi

# --- counters -------------------------------------------------------------------------------
#
# One line per consumed round, appended BEFORE the round is applied. A round that is applied and
# then not recorded is the failure the file exists to close, so the writing order is the rule.
#
# The header line is what separates "no repair has happened" from "we do not know what happened".
# A replacement run gets a fresh evidence directory, so an ABSENT file reads as unknown history
# and blocks another repair until a person reconciles it — `resume-free-budget` is the falsifier.
counters_file() { printf '%s/COUNTERS' "$DIR"; }

counters_history_known() { [ -f "$(counters_file)" ] && grep -q '^history:' "$(counters_file)"; }

# How many rounds of <kind> a COUNTERS file accounts for: what it carried forward from a
# predecessor, plus what this run has consumed since. Taking the file as an argument is what lets
# a replacement run read its predecessor's total through the same arithmetic.
counter_used_in() {
  local file="$1" kind="$2" carried used
  [ -f "$file" ] || { printf '0'; return; }
  carried="$(sed -n "s/^carried:[[:space:]]*$kind[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p" "$file" | head -n 1)"
  used="$(grep -c "^counter=$kind " "$file" 2>/dev/null)" || used=0
  printf '%s' "$(( ${carried:-0} + ${used:-0} ))"
}

counter_used() { counter_used_in "$(counters_file)" "$1"; }

print_counters() {
  local kind used
  printf 'repair counters (limit %d each, and none substitutes for another)\n' "$COUNTER_LIMIT"
  if counters_history_known; then
    printf '  history       %s\n' "$(sed -n 's/^history:[[:space:]]*//p' "$(counters_file)" | head -n 1)"
  else
    printf '  history       UNKNOWN — no COUNTERS record. Unknown is not zero; it blocks another repair.\n'
    printf '                Reconcile it: phase-record.sh counters init --none\n'
    printf '                          or: phase-record.sh counters init --predecessor <runId>\n'
  fi
  for kind in $COUNTER_KINDS; do
    used="$(counter_used "$kind")"
    printf '  %-15s %s of %d used%s\n' "$kind" "$used" "$COUNTER_LIMIT" \
      "$([ "$used" -ge "$COUNTER_LIMIT" ] && printf ' — EXHAUSTED' || printf '')"
  done
}

counters_over_limit() {
  local kind
  for kind in $COUNTER_KINDS; do
    [ "$(counter_used "$kind")" -gt "$COUNTER_LIMIT" ] && { printf '%s' "$kind"; return 0; }
  done
  return 1
}

# --- subcommands ------------------------------------------------------------------------------

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in
  --help | -h | help)
    usage
    exit 0
    ;;

  set)
    name="${1:-}"
    valid_record_name "$name" || die "\"$name\" is not a record name (A-Z, digits and underscore, 32 chars)"
    shift
    mkdir -p "$DIR" || refuse "could not create $DIR"
    if [ "$#" -gt 0 ]; then
      printf '%s\n' "$*" > "$DIR/$name"
    else
      cat > "$DIR/$name"
    fi
    [ -s "$DIR/$name" ] || { rm -f "$DIR/$name"; refuse "an empty $name record says nothing; write the disposition, or \"not applicable\" and why"; }
    printf 'wrote %s\n' "$DIR/$name"
    ;;

  get)
    name="${1:-}"
    valid_record_name "$name" || die "\"$name\" is not a record name"
    [ -f "$DIR/$name" ] || refuse "no $name record for this run"
    cat "$DIR/$name"
    ;;

  list)
    printf 'phase records for %s\n' "$TASK_ID"
    printf '  directory     %s\n' "$DIR"
    found=0
    for entry in "${REQUIRED_AT_READINESS[@]}"; do
      name="${entry%%|*}"
      if [ -s "$DIR/$name" ]; then printf '  %-14s present\n' "$name"; found=$((found + 1))
      else printf '  %-14s ABSENT\n' "$name"; fi
    done
    for name in BLOCKED VERIFICATION DELIVERED REFRESH AC_VERIFICATION; do
      [ -s "$DIR/$name" ] && printf '  %-14s present\n' "$name"
    done
    printf '  %d of %d records required at readiness are present\n' "$found" "${#REQUIRED_AT_READINESS[@]}"
    ;;

  check)
    predicates=0
    [ "${1:-}" = "--predicates" ] && predicates=1
    missing=0
    for entry in "${REQUIRED_AT_READINESS[@]}"; do
      name="${entry%%|*}"
      rest="${entry#*|}"
      predicate="${rest%%|*}"
      wants="${rest#*|}"
      if [ ! -s "$DIR/$name" ]; then
        missing=$((missing + 1))
        if [ "$predicates" -eq 1 ]; then
          printf '%s|this task recorded no %s. It must say %s. Write it: bash .xezar/checks/phase-record.sh set %s "..." (see .xezar/docs/phase-record.md)\n' \
            "$predicate" "$name" "$wants" "$name"
        else
          printf 'MISSING %-14s %s\n' "$name" "$wants"
        fi
      fi
    done

    # A declared REFRESH round (#670). A round whose only job is to merge the base into a pull
    # request and refresh the seal makes no content claim of its own, so it has no criterion to put
    # in CRITERIA. Before this it had no shape readiness would accept, and the round either failed
    # (`phase.criteria`) or dressed itself up as work it did not do. REFRESH is that shape: it names
    # the refresh, the merged base sha and the evidence it refreshed, and it stands in for the
    # content claim ONLY when it carries none of its own. It is not a generic bypass — a REFRESH
    # record that carries a content claim is refused, and a round with no REFRESH is judged by
    # CRITERIA exactly as before. The predicate stays `phase.criteria` because the refusal is about
    # the accepted-criteria INPUT, of which REFRESH is the refresh-round spelling.
    refresh_declared=0
    if [ -s "$DIR/REFRESH" ]; then
      refresh_name="$(sed -n 's/^refresh:[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p' "$DIR/REFRESH" | head -n 1)"
      refresh_base="$(sed -n 's/^base:[[:space:]]*\([0-9a-fA-F]\{40\}\)[[:space:]]*$/\1/p' "$DIR/REFRESH" | head -n 1)"
      refresh_evidence="$(sed -n 's/^evidence:[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p' "$DIR/REFRESH" | head -n 1)"
      refresh_claim="$(grep -E '^[[:space:]]*(AC-|DP-)[A-Za-z0-9._-]+:' "$DIR/REFRESH" | head -n 1)"
      if [ -n "$refresh_claim" ]; then
        missing=$((missing + 1))
        if [ "$predicates" -eq 1 ]; then
          printf 'phase.criteria|the REFRESH record carries a content claim ("%s"). A refresh round makes no content claim: a criterion belongs in CRITERIA with its accepted-by line. Readiness refuses a REFRESH record that claims content.\n' "$refresh_claim"
        else
          printf 'INVALID REFRESH       carries a content claim ("%s")\n' "$refresh_claim"
        fi
      elif [ -z "$refresh_name" ] || [ -z "$refresh_base" ] || [ -z "$refresh_evidence" ]; then
        missing=$((missing + 1))
        if [ "$predicates" -eq 1 ]; then
          printf 'phase.criteria|the REFRESH record does not name all three things a refresh round must: "refresh: <what was refreshed>", "base: <full 40-character sha of the merged base>" and "evidence: <the evidence it refreshed>". A declaration that names none of them does not stand in for a content claim.\n'
        else
          printf 'INVALID REFRESH       missing a refresh:, base: or evidence: line\n'
        fi
      else
        refresh_declared=1
      fi
    fi

    # CRITERIA is the AC INPUT, and an empty ladder rung is the `template-is-acceptance` failure:
    # a file that exists but names no criterion and no accepting authority is not acceptance. A
    # declared REFRESH round is the one case where an absent content claim is correct: the round
    # claims no content, and the declaration above says what it did instead. When it DOES carry a
    # content claim, the claim is judged by the normal rule even alongside a REFRESH declaration —
    # otherwise a REFRESH record plus a bare criterion would skip the accepted-by line.
    if [ -s "$DIR/CRITERIA" ]; then
      if [ "$refresh_declared" -eq 1 ] && ! grep -Eq '^[[:space:]]*(AC-|DP-)[A-Za-z0-9._-]+:' "$DIR/CRITERIA"; then
        : # a declared refresh round makes no content claim; REFRESH stands in for it
      else
        if ! grep -Eq '^[[:space:]]*(AC-|DP-)[A-Za-z0-9._-]+:' "$DIR/CRITERIA"; then
          missing=$((missing + 1))
          if [ "$predicates" -eq 1 ]; then
            printf 'phase.criteria|the CRITERIA record names no acceptance criterion. Each accepted criterion needs its own "<ID>: <what a reader can check>" line — a file that exists is not acceptance. A round that makes no content claim (a merge-only refresh) declares that in REFRESH instead.\n'
          else
            printf 'INVALID CRITERIA      no "<ID>: <criterion>" line\n'
          fi
        fi
        if ! grep -Eq '^[[:space:]]*accepted-by:[[:space:]]*[^[:space:]]' "$DIR/CRITERIA"; then
          missing=$((missing + 1))
          if [ "$predicates" -eq 1 ]; then
            printf 'phase.criteria|the CRITERIA record has no "accepted-by: <authority and when>" line, so nothing says who accepted these criteria. A shipped template or a mutable label is not an acceptance.\n'
          else
            printf 'INVALID CRITERIA      no "accepted-by:" line\n'
          fi
        fi
      fi
    fi

    if [ -s "$DIR/COUNTERS" ] && ! counters_history_known; then
      missing=$((missing + 1))
      if [ "$predicates" -eq 1 ]; then
        printf 'phase.counters|the COUNTERS record has no "history:" line, so the repair history is unknown. Unknown is not zero — reconcile it with phase-record.sh counters init.\n'
      else
        printf 'INVALID COUNTERS      no "history:" line\n'
      fi
    fi

    if over="$(counters_over_limit)"; then
      missing=$((missing + 1))
      if [ "$predicates" -eq 1 ]; then
        printf 'phase.counters|the "%s" counter records %s consumed rounds, over its limit of %d. An exhausted counter blocks another repair: stop and report the remaining failure with its evidence.\n' \
          "$over" "$(counter_used "$over")" "$COUNTER_LIMIT"
      else
        printf 'OVER    COUNTERS      "%s" is at %s of %d\n' "$over" "$(counter_used "$over")" "$COUNTER_LIMIT"
      fi
    fi

    [ "$missing" -eq 0 ] || exit 1
    [ "$predicates" -eq 1 ] || printf 'PHASE RECORD OK — every record readiness requires is present\n'
    ;;

  counters)
    if [ "${1:-}" = "init" ]; then
      shift
      mkdir -p "$DIR" || refuse "could not create $DIR"
      case "${1:-}" in
        --none)
          {
            printf '# Repair counters for run %s. One line per consumed round, appended BEFORE the round.\n' "$TASK_ID"
            printf 'history: complete — no predecessor run; this candidate starts at zero\n'
          } > "$(counters_file)"
          ;;
        --predecessor)
          prev="${2:-}"
          valid_task_id "$prev" || die "--predecessor needs the predecessor's run id"
          # Both evidence roots: a predecessor that ran before the rename window keeps its
          # evidence where it wrote it. Missing history blocks a legitimate repair, so looking in
          # one root only would turn a merely older predecessor into "unknown".
          prev_file="$(task_evidence_dir_of "$prev")/COUNTERS"
          [ -f "$prev_file" ] || refuse "the predecessor run $prev has no COUNTERS record, so its history is unknown. Unknown is not zero: reconcile it with a person before another repair."
          {
            printf '# Repair counters for run %s. One line per consumed round, appended BEFORE the round.\n' "$TASK_ID"
            printf 'history: complete — carried forward from predecessor %s\n' "$prev"
            for kind in $COUNTER_KINDS; do
              printf 'carried: %s = %s (from %s)\n' "$kind" "$(counter_used_in "$prev_file" "$kind")" "$prev"
            done
          } > "$(counters_file)"
          ;;
        *)
          die 'counters init needs --none or --predecessor <runId>'
          ;;
      esac
      print_counters
      exit 0
    fi
    # `--exhausted <kind>` is the question a caller asks before authorizing another repair: exit
    # 0 when that counter is spent (or its history is unknown, which blocks the same way).
    if [ "${1:-}" = "--exhausted" ]; then
      kind="${2:-}"
      case " $COUNTER_KINDS " in *" $kind "*) ;; *) die "unknown counter \"$kind\"; one of: $COUNTER_KINDS" ;; esac
      counters_history_known || exit 0
      [ "$(counter_used "$kind")" -ge "$COUNTER_LIMIT" ] && exit 0
      exit 1
    fi
    print_counters
    ;;

  counter)
    kind="${1:-}"
    case " $COUNTER_KINDS " in *" $kind "*) ;; *) die "unknown counter \"$kind\"; one of: $COUNTER_KINDS" ;; esac
    shift
    trigger=""
    dry=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --trigger) shift; trigger="${1:-}" ;;
        --dry-run) dry=1 ;;
        *) die "unknown argument \"$1\"" ;;
      esac
      shift || true
    done
    [ -n "$trigger" ] || die 'a counter round needs --trigger "<what triggered this repair>"'

    counters_history_known || refuse "the repair history for this run is UNKNOWN (no COUNTERS record). Unknown is not zero and it blocks another repair. Reconcile it first: phase-record.sh counters init --none, or --predecessor <runId> for a replacement run."

    used="$(counter_used "$kind")"
    if [ "$used" -ge "$COUNTER_LIMIT" ]; then
      printf 'phase-record: the "%s" counter is EXHAUSTED (%s of %d used).\n' "$kind" "$used" "$COUNTER_LIMIT" >&2
      printf '              Stop and report the remaining failure with its evidence. Never lower a\n' >&2
      printf '              severity, a threshold or a mandatory check to get past it, and never use a\n' >&2
      printf '              different counter to pay for this round — none substitutes for another.\n' >&2
      printf '              Genuinely new scope needs a new accepted plan, not the same finding relabelled.\n' >&2
      exit 1
    fi
    if [ "$dry" -eq 1 ]; then
      printf 'would consume round %d of %d for "%s"\n' "$((used + 1))" "$COUNTER_LIMIT" "$kind"
      exit 0
    fi
    printf 'counter=%s round=%d at=%s trigger=%s\n' \
      "$kind" "$((used + 1))" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$trigger" | tr '\n' ' ')" >> "$(counters_file)"
    printf 'consumed round %d of %d for "%s"\n' "$((used + 1))" "$COUNTER_LIMIT" "$kind"
    ;;

  *)
    printf 'phase-record: unknown subcommand "%s"\n\n' "$cmd" >&2
    usage >&2
    exit 2
    ;;
esac
