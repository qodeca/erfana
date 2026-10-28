#!/usr/bin/env bash
# Read-only verification of ONE explicitly named integration target.
#
# This script decides nothing and changes nothing. It answers a single question — "is every
# precondition for merging this exact pull request into this exact base true, right now?" — and
# prints a verdict a human or an integration agent then acts on. It never merges, never pushes,
# never closes an issue and never writes to GitHub. `.xezar/skills/xezar-integration.md` is the
# procedure; this is the gate in front of it.
#
# WHY IT REFUSES DEFAULTS. Every target is a required argument with no fallback. A merge helper
# that guesses its repository, its PR number, its base or its head is one stale variable away from
# integrating the wrong thing, and the blast radius is a shared branch. `--expected-head` in
# particular is the anti-race: the PR head is re-read here and compared, so a push that lands
# between review and merge is a refusal rather than a surprise.
#
# WHAT IT CANNOT DO. It matches FACTS, never AUTHORITY. It can confirm that an authority record
# exists, names this PR and this head, and is well-formed. It cannot confirm that whoever wrote it
# was entitled to. Nothing this script prints is permission to merge, and a green verdict is not a
# decision — see `verdict` at the bottom, which says so out loud.
#
# F-PROT-01 (observed 2026-09-08, campaign 20260908-r3). The legacy
# `repos/{o}/{r}/branches/{b}/protection` endpoint answers 404 on this repository while `main`
# is in fact protected by an active ruleset. A 404 there means "this legacy endpoint has nothing to
# say", NOT "the branch is unprotected". Effective rules are read from
# `repos/{o}/{r}/rules/branches/{b}`, and a permission failure is reported as UNAVAILABLE — never
# as "none". Refusing to distinguish those two is how a protected branch gets treated as open.
#
# Branch-enforced contexts and this project's delivery contract are DIFFERENT requirements. GitHub
# enforces a subset; passing only that subset does not waive the rest. Both are checked.
#
# GitHub is reached through one indirection, `$KIT_TEST_GH` (default `gh`), so the boundary can be
# driven by a stub in the test suite. There is no other network call in this file.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

GH="${KIT_TEST_GH:-gh}"

# This project's delivery contract: every required CI check, named EXACTLY as the check-runs API
# reports it. The list is `ci.requiredChecks` in `.xezar/pipeline/config.json` — a project fact,
# never baked into this script, which ships into every onboarded repository. An empty list means
# this project states no required checks, and only GitHub's enforced subset is compared.
#
# F-A1, 2026-09-09 (#116 review). These are check-RUN names, which are not always the job id. The
# `integration` job is reported as **`integration / integration`** — a reusable/nested workflow
# renders as `<caller> / <job>` — and the first version of this list carried the bare job id. The
# consequence was a FALSE REFUSAL: a check that had actually passed was reported `checks.absent`,
# and integration would have been blocked on a green build.
#
# The fix is the exact real name, NOT substring matching. Loosening the comparison would let
# `verify` match `verify-something-else` and would trade a visible false refusal for an invisible
# false pass, which is the far worse failure here. The CI job ids and `ci.yml` are unchanged; only
# this list, which describes what the API returns, was wrong.
#
# `integration / integration` is credential-gated. It may report `success` with its assertions
# skipping internally, or `skipped` outright — both are legitimate, and `skipped` is reported as
# its own fourth word, never folded into "all green".
#
# F-A2. RENAMING A CI JOB BREAKS THIS GATE UNTIL THE CONFIG FOLLOWS, and the sequencing has no
# safe gap: state the new name first and it names a check no run produces yet; state it afterwards
# and there is a window where the old name exists on no run at all. Either way every merge through
# this gate is refused, because a name that no run reports is `checks.absent` and absent is a
# refusal — correctly so, and that refusal is deliberately NOT relaxed. No fallback, no wildcard,
# no override: the only fix for a renamed check is to state its new real name in
# `ci.requiredChecks`, in the same change as the rename.
#
# Read every name from the check-runs API on a real head, never from the workflow file, for the
# reason F-A1 records above.
#
# Declared empty here and filled from the config once this checkout's identity is resolved, in
# section 2 — the config is read relative to the checkout, so it cannot be read before that.
PROJECT_CHECKS=()
SKIP_ALLOWED=()

usage() {
  cat <<'EOF'
usage: integration-preflight.sh --repo <owner/name> --pr <number> --base <branch>
                                --expected-head <full-sha> --authority <path>
                                [--issue <number>]

Every target is required and none is guessed. Read-only: this script never writes to git or
GitHub. It reports whether the preconditions hold; it does not grant permission to act on them.

  --repo           owner/name, and it must match this checkout's origin remote
  --pr             the pull request number to integrate
  --base           the base branch; must equal the configured baseBranch (never `main`)
  --expected-head  the 40-character SHA the review and evidence refer to
  --authority      path to the explicit authorization record for THIS merge
  --issue          a single issue whose closure was separately and explicitly authorized
EOF
}

REPO="" PR="" BASE="" EXPECTED_HEAD="" AUTHORITY="" ISSUE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --pr) PR="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --expected-head) EXPECTED_HEAD="${2:-}"; shift 2 ;;
    --authority) AUTHORITY="${2:-}"; shift 2 ;;
    --issue) ISSUE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'integration-preflight: unknown argument "%s"\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

refusals=()
unavailable=()
observations=()
# A refusal names the predicate that produced it, so a reader can tell "the head moved" from
# "I could not read the head" without re-running anything.
refuse() { refusals+=("[$1] $2"); }
unavail() { unavailable+=("[$1] $2"); }
observe() { observations+=("$1"); }

# --- 1. Arguments ------------------------------------------------------------------------
[ -n "$REPO" ]          || refuse args.repo "--repo is required; this script never infers a repository"
[ -n "$PR" ]            || refuse args.pr "--pr is required"
[ -n "$BASE" ]          || refuse args.base "--base is required; it is never defaulted"
[ -n "$EXPECTED_HEAD" ] || refuse args.expected-head "--expected-head is required; it is the anti-race"
[ -n "$AUTHORITY" ]     || refuse args.authority "--authority is required"

case "$REPO" in
  */*) : ;;
  *) [ -n "$REPO" ] && refuse args.repo "--repo must be owner/name, got \"$REPO\"" ;;
esac
# N-A2, 2026-09-09 (#116 review). The old test was `''|*[0-9]`, which accepts anything ENDING in a
# digit — "12abc3", or a value carrying regex metacharacters — and that value was then interpolated
# into a `grep -E` pattern below, making the pattern caller-controlled. Both numbers are now
# anchored end to end, so what reaches a regex is provably digits and nothing else.
if [ -n "$ISSUE" ] && ! printf '%s' "$ISSUE" | grep -qE '^[0-9]+$'; then
  refuse args.issue "--issue must be a plain issue number, got \"$ISSUE\""
fi
if [ -n "$PR" ] && ! printf '%s' "$PR" | grep -qE '^[0-9]+$'; then
  refuse args.pr "--pr must be a plain pull request number, got \"$PR\""
fi
# A short SHA is not an identity: it can become ambiguous as the repository grows, and it cannot
# be compared byte-for-byte against what GitHub returns.
if [ -n "$EXPECTED_HEAD" ] && ! printf '%s' "$EXPECTED_HEAD" | grep -qE '^[0-9a-f]{40}$'; then
  refuse args.expected-head "--expected-head must be a full 40-character SHA, got \"$EXPECTED_HEAD\""
fi

if [ ${#refusals[@]} -gt 0 ]; then
  printf '=== integration preflight ===\n'
  printf '\nREFUSED — the request itself is not well-formed:\n'
  for r in "${refusals[@]}"; do printf '  - %s\n' "$r"; done
  exit 1
fi

# --- 2. This checkout ---------------------------------------------------------------------
# Identity is resolved the same way every other check here resolves it, so a target that does not
# belong to this repository is caught before a single API call is spent.
if resolve_task_paths >/dev/null 2>&1; then
  observe "checkout: $TASK_CWD on $BRANCH"
  # This project's required check names. A plain `while read`, not `mapfile`: this script runs on
  # whatever bash the installing machine has, and macOS still ships 3.2 as /bin/bash.
  if ! project_checks_raw="$(pipeline_config_list ci.requiredChecks)"; then
    unavail checks.config 'the pipeline config could not be read; required check names unknown'
  else
    while IFS= read -r want; do
      [ -n "$want" ] && PROJECT_CHECKS+=("$want")
    done <<CHECKS
$project_checks_raw
CHECKS
  fi
  if [ ${#PROJECT_CHECKS[@]} -eq 0 ]; then
    observe "required checks: none configured (ci.requiredChecks) — only enforced rules are compared"
  fi
else
  unavail checkout.unresolved "could not resolve this checkout's identity; repository binding not verified"
fi

origin="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$origin" ]; then
  unavail repo.origin "no origin remote; cannot confirm --repo names this repository"
else
  # Accept both SSH and HTTPS spellings, strip a trailing .git, compare owner/name only.
  origin_slug="$(printf '%s' "$origin" | sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##')"
  if [ "$origin_slug" != "$REPO" ]; then
    refuse repo.mismatch "--repo is \"$REPO\" but origin is \"$origin_slug\""
  fi
fi

configured_base="$(xezar_base_branch)" || refuse base.unavailable "cannot resolve configured base"
if [ "$BASE" != "$configured_base" ]; then
  refuse base.forbidden "--base is \"$BASE\"; the only integration base here is \"$configured_base\". Release publication uses the manually dispatched Release workflow under existing authority."
fi

# --- 3. Authority ---------------------------------------------------------------------------
# Missing authority is NOT a failure to merge. It is a completed proposal awaiting a decision, and
# it is reported that way so nobody reads it as an error to be retried past.
authority_present=0
if [ ! -f "$AUTHORITY" ]; then
  refuse authority.missing "no authorization record at \"$AUTHORITY\". This is a PROPOSAL awaiting a decision, not a failed merge — do not retry, do not proceed."
else
  authority_present=1
  # The record must name what it authorizes. An authorization that does not pin the PR and the
  # head could be re-used against a different revision, which is the whole risk.
  grep -qE "(^|[^0-9])#?${PR}([^0-9]|$)" "$AUTHORITY" \
    || refuse authority.scope "the record at \"$AUTHORITY\" does not name PR #$PR"
  grep -qF "$EXPECTED_HEAD" "$AUTHORITY" \
    || refuse authority.head "the record at \"$AUTHORITY\" does not name head $EXPECTED_HEAD; an authorization that does not pin a revision is not one"
  # ISSUE CLOSURE IS A SEPARATE GRANT, and this is where that grant is read.
  #
  # What is checked: when — and only when — `--issue` is passed, the AUTHORITY record must say, in
  # words, that closing that issue is authorized. The record is the explicit authorization, so a
  # keyword *there* IS the grant taking a written form. That is different from reading a keyword
  # out of a PR body or a commit message and treating it as permission, which this never does.
  #
  # Passing no `--issue` closes nothing. That is the ordinary case and stays fully supported: this
  # campaign's own pull requests say "Relates #116" and close nothing, and nothing here makes that
  # harder. A closing keyword in a PR body remains GitHub's own automation and is not evidence of
  # authority; keep them out of PR bodies unless closure really is authorized.
  #
  # N-A3, 2026-09-09 (#116 review): the match was case-sensitive, so "Closes #116" — the spelling
  # people actually write — was rejected as unauthorized. That was a false refusal, not a hole. The
  # supported verbs are GitHub's own, matched case-insensitively and anchored on the exact number.
  if [ -n "$ISSUE" ] \
     && ! grep -qiE "(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)[^0-9]{0,20}#?${ISSUE}([^0-9]|$)" "$AUTHORITY"; then
    refuse authority.issue "closure of issue #$ISSUE is not explicitly authorized in \"$AUTHORITY\". Issue closure is a separate grant; a merge never implies one, and neither does a keyword found anywhere else."
  fi
fi

# --- 4. The pull request, as it is RIGHT NOW -------------------------------------------------
pr_json=""
if ! pr_json="$("$GH" api "repos/$REPO/pulls/$PR" 2>&1)"; then
  # A missing PR and an unreachable API are different answers and must not collapse into one.
  if printf '%s' "$pr_json" | grep -qiE 'not found|HTTP 404'; then
    refuse pr.missing "no pull request #$PR in $REPO"
  else
    unavail pr.unreadable "could not read PR #$PR: $(printf '%s' "$pr_json" | head -1)"
  fi
  pr_json=""
fi

field() { printf '%s' "$pr_json" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const o=JSON.parse(s); const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);
      process.stdout.write(v==null?"":String(v)); } catch { process.stdout.write(""); }
  });' "$1" 2>/dev/null; }

actual_head="" pr_state="" pr_merged="" pr_base="" pr_draft="" mergeable_state=""
if [ -n "$pr_json" ]; then
  policy="$(printf '%s' "$pr_json" | node "$SCRIPT_DIR/lib/project-policy.mjs")"
  policy_unavailable="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s).unavailable||"")}catch{process.stdout.write("policy evaluator unavailable")}})')"
  policy_refused="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s).refused||"")}catch{}})')"
  [ -z "$policy_unavailable" ] || unavail project.policy "$policy_unavailable"
  [ -z "$policy_refused" ] || refuse project.policy "$policy_refused"
  actual_head="$(field head.sha)"
  pr_state="$(field state)"
  pr_merged="$(field merged)"
  pr_base="$(field base.ref)"
  pr_draft="$(field draft)"
  mergeable_state="$(field mergeable_state)"
  observe "PR #$PR: state=$pr_state merged=$pr_merged base=$pr_base draft=$pr_draft head=$actual_head"

  # Already merged is a SUCCESSFUL prior outcome, not something to redo. Reporting it as a
  # refusal to act is what stops a retry from producing a second merge or a duplicate comment.
  if [ "$pr_merged" = "true" ]; then
    refuse pr.already-merged "PR #$PR is already merged. Nothing to do — this is a completed prior outcome, not a failure. Do not retry."
  elif [ "$pr_state" != "open" ]; then
    refuse pr.state "PR #$PR is \"$pr_state\", not open"
  fi
  if [ "$pr_draft" = "true" ]; then
    refuse pr.draft "PR #$PR is still a draft. Marking it ready is a separate, explicitly authorized act."
  fi
  if [ -n "$pr_base" ] && [ "$pr_base" != "$BASE" ]; then
    refuse base.mismatch "PR #$PR targets \"$pr_base\", not the requested \"$BASE\""
  fi
  # THE ANTI-RACE. --expected-head pins the head only; it does NOT atomically pin the base, so a
  # moved base is reported separately below and forces its own compatibility decision.
  if [ -n "$actual_head" ] && [ "$actual_head" != "$EXPECTED_HEAD" ]; then
    refuse head.moved "PR #$PR head is $actual_head; the review, the evidence and the authority all refer to $EXPECTED_HEAD. Re-review and re-check at the new head."
  fi
fi

# --- 5. The base, and whether it moved ---------------------------------------------------------
# `--expected-head` cannot pin the base. If the base advanced past what was tested, the tested
# combination no longer exists and that is a compatibility decision, not an automatic pass.
base_sha=""
if base_json="$("$GH" api "repos/$REPO/commits/$BASE" 2>&1)"; then
  base_sha="$(printf '%s' "$base_json" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { process.stdout.write(String(JSON.parse(s).sha||"")); } catch { process.stdout.write(""); }});' 2>/dev/null)"
  observe "base $BASE at $base_sha"
  if [ -n "$pr_json" ]; then
    merge_base_sha="$(field base.sha)"
    if [ -n "$merge_base_sha" ] && [ -n "$base_sha" ] && [ "$merge_base_sha" != "$base_sha" ]; then
      refuse base.moved "$BASE is now $base_sha but PR #$PR was opened against $merge_base_sha. The tested combination no longer exists: re-run the required checks at the new base and take an explicit compatibility decision."
    fi
  fi
else
  unavail base.unreadable "could not read $BASE: $(printf '%s' "$base_json" | head -1)"
fi

# --- 6. Effective branch rules (F-PROT-01) -------------------------------------------------------
# Read the EFFECTIVE rules. The legacy protection endpoint is consulted only to be reported, never
# to conclude anything: its 404 on this repository is a fact about the endpoint, not the branch.
required_contexts=""
# REQUIRED_REVIEWS is the number of approving GitHub reviews policy actually demands. It starts
# UNKNOWN, never 0: "I could not read the policy" and "the policy requires none" are different
# answers, and collapsing them is how a missing scope becomes a licence to merge.
REQUIRED_REVIEWS="unknown"
legacy_reviews="unknown"
# The strictest applicable rule wins. Multiple rulesets can apply to one branch, and taking the
# last one read — or the first — would silently drop a stricter requirement.
raise_required_reviews() {
  case "$1" in ''|*[!0-9]*) return 0 ;; esac
  if [ "$REQUIRED_REVIEWS" = "unknown" ] || [ "$1" -gt "$REQUIRED_REVIEWS" ]; then
    REQUIRED_REVIEWS="$1"
  fi
}

if legacy="$("$GH" api "repos/$REPO/branches/$BASE/protection" 2>&1)"; then
  observe "legacy protection endpoint: readable"
  # When the legacy endpoint IS present it is applicable policy and is read for its review count
  # too — not just reported. Its absence still concludes nothing (F-PROT-01).
  legacy_reviews="$(printf '%s' "$legacy" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const n = JSON.parse(s)?.required_pull_request_reviews?.required_approving_review_count;
        process.stdout.write(Number.isInteger(n) ? String(n) : "");
      } catch { process.stdout.write(""); }});' 2>/dev/null)"
  if [ -n "$legacy_reviews" ]; then
    raise_required_reviews "$legacy_reviews"
    observe "legacy protection requires $legacy_reviews approving review(s)"
  fi
else
  if printf '%s' "$legacy" | grep -qiE 'not found|HTTP 404'; then
    observe "legacy protection endpoint: 404 — says NOTHING about protection; effective rules are authoritative (F-PROT-01)"
  else
    observe "legacy protection endpoint: unreadable (not interpreted)"
  fi
fi

if rules="$("$GH" api "repos/$REPO/rules/branches/$BASE" 2>&1)"; then
  # One parse, two answers: the required contexts and the required approving-review count. Field
  # names are taken from a real response for this repository (`GET repos/{o}/{r}/rules/branches/
  # {b}`, ruleset 18814916): a `pull_request` rule carries
  # `parameters.required_approving_review_count`. Nothing here is guessed, and this is not a
  # general policy engine — it reads the two fields this script actually needs.
  rules_parsed="$(printf '%s' "$rules" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const rs = JSON.parse(s);
        if (!Array.isArray(rs)) { process.stdout.write("MALFORMED"); return; }
        const contexts = [];
        let reviews = null;
        for (const r of rs) {
          const checks = r?.parameters?.required_status_checks;
          for (const c of Array.isArray(checks) ? checks : []) if (c?.context) contexts.push(c.context);
          if (r?.type === "pull_request") {
            const n = r?.parameters?.required_approving_review_count;
            // A pull_request rule with no readable count is NOT zero; leave it unknown so the
            // caller reports INCOMPLETE rather than inventing a permissive answer.
            if (!Number.isInteger(n)) { process.stdout.write("MALFORMED"); return; }
            reviews = reviews === null ? n : Math.max(reviews, n);
          }
        }
        process.stdout.write(`${reviews === null ? "" : reviews}\n${[...new Set(contexts)].join("\n")}`);
      } catch { process.stdout.write("MALFORMED"); }});' 2>/dev/null)"
  if [ "$rules_parsed" = "MALFORMED" ]; then
    unavail rules.malformed "the effective branch rules for $BASE could not be interpreted. Unparseable policy is UNKNOWN, never zero."
    required_contexts=""
  else
    rules_reviews="$(printf '%s' "$rules_parsed" | head -1)"
    required_contexts="$(printf '%s' "$rules_parsed" | tail -n +2)"
    if [ -n "$rules_reviews" ]; then
      raise_required_reviews "$rules_reviews"
      observe "effective branch rules require $rules_reviews approving review(s)"
    else
      # No `pull_request` rule at all means this policy source imposes no review requirement. That
      # is a real answer, unlike an unreadable one, so it may settle the count at zero.
      raise_required_reviews 0
      observe "effective branch rules contain no pull_request rule — this source requires no approving review"
    fi
  fi
  if [ -n "$required_contexts" ]; then
    observe "effective branch rules require: $(printf '%s' "$required_contexts" | tr '\n' ' ')"
  else
    observe "effective branch rules readable and list no required status check"
  fi
else
  # A permission failure is UNAVAILABLE. Treating it as "no rules" is the precise mistake
  # F-PROT-01 records, and it would turn a missing scope into a licence to merge.
  if printf '%s' "$rules" | grep -qiE 'HTTP 40[13]|permission|forbidden|must have admin'; then
    unavail rules.permission "effective branch rules for $BASE are UNAVAILABLE (permission), which is not the same as none. Do not infer that $BASE is unprotected."
  else
    unavail rules.unreadable "could not read effective branch rules for $BASE: $(printf '%s' "$rules" | head -1)"
  fi
fi

# --- 7. Checks at the exact head ------------------------------------------------------------------
# Two distinct requirements. GitHub enforces a subset; this project expects all of PROJECT_CHECKS.
# Passing the enforced subset does not waive the rest, and pending is pending — never a pass.
#
# F-A7, 2026-09-10 (#180). ONE COMMIT CARRIES MANY RUNS OF ONE NAME, and this block used to read
# only the first the API happened to return (`$1==n{print; exit}`). Two ordinary things produce
# duplicates: `gh run rerun` creates a NEW check run rather than mutating the old one, and the same
# SHA reachable from two refs gets an independent run per ref. The check-runs endpoint documents no
# ordering guarantee, so "first returned" was neither the newest nor the worst — it was arbitrary,
# and an arbitrary pick can hand back an older `success` while the newest run is red. That is a
# FALSE PASS, the one direction this file exists to prevent, and unlike F-A1's false refusal it is
# invisible: the gate simply prints `check <name>: success` and the merge proceeds.
#
# Observed in the wild: one commit with six runs, three of them sharing a name, started 13:23:14
# (failure), 13:32:07 (success) and 13:39:16 (success) UTC.
#
# THE RULE: per required NAME, the NEWEST run by `started_at` decides — but only once every run of
# that name has finished.
#
#   1. no run of that name          -> checks.absent   (unchanged; absent is a refusal)
#   2. ANY run of that name unfinished -> checks.pending
#   3. otherwise the newest by `started_at` supplies the conclusion, read exactly as before
#   4. anything that makes 2/3 undecidable -> checks.ambiguous
#
# Why newest-wins and not "every run must be green": a re-run after a genuinely red run is a
# workflow this project uses (see #177, a flaky browser job), and "all green" would mean a SHA that
# ever went red could never merge without being rewritten — that is a false refusal with no escape,
# traded for a false pass. It is close to what a human reading the Checks tab concludes, and it is
# NOT a claim of equivalence with GitHub's own required-status-checks: that machinery can pin an
# expected app per context, and this one cannot (see G3 below). Do NOT "fix" a future complaint here
# by taking the first `success` found: that is the bug #180 named, and it is the one shape that is
# strictly worse than what was here before.
#
# Why rule 2 is "ANY unfinished" rather than "the newest is unfinished": an unfinished run can still
# go red, and waiting is a refusal that CLEARS BY ITSELF in minutes — the cheapest possible
# conservative answer. It also keeps `absent` and `pending` the distinct words they already were.
#
# FAILING CLOSED is the whole point, so every undecidable shape refuses rather than falling through:
# a `started_at` missing or unparseable on any run that is being ordered, several newest runs tied
# at the same instant with DIFFERENT conclusions, or a body whose shape is not what the API
# documents. A tie whose conclusions AGREE is not undecidable and is accepted — the order cannot
# change the answer. Grouping happens once, in node, and emits exactly ONE resolved line per
# distinct name, which is what makes the `exit` in the two lookups below correct again.
#
# READING THE WHOLE HISTORY IS PART OF THE SAME BUG, and the rule above is what makes it
# load-bearing. Two separate things reduce what one request returns, and BOTH of them could always
# hand back an older green — the old first-match reader was no safer here, it simply picked
# arbitrarily from whatever subset arrived:
#
#   `filter` — G1, 2026-09-10 (#186 review). The endpoint's DEFAULT is `filter=latest`, which is a
#   different selection rule from this one: it reduces by COMPLETION time and by check suite, while
#   the policy above claims to inspect every run and order by `started_at`. A response already
#   narrowed by someone else's rule cannot evidence "every run of that name". Measured on
#   `46553b9151f9e916a219e38534b0085b07608642`: the default answers 6 runs, `filter=all` answers 10.
#   The four it hides are older browser failures (`102883935449`, `102887870384`) and duplicate
#   `Typecheck…` records from check suite `93406922306`. At that observation the later runs are all
#   green, so this is proof of HIDDEN INPUT, not a demonstrated bad merge — but the program cannot
#   enforce a policy over a set it never received. `filter=all` is therefore requested explicitly.
#
#   pages — the endpoint pages, defaulting to 30, and one request returns one page. `per_page=100`
#   is asked for and the `total_count` the endpoint reports is compared against what actually
#   arrived; a short read is UNREADABLE, never a verdict on the runs that did arrive. This is a
#   COMPLETENESS CHECK with a disclosed ceiling, not pagination support: a commit carrying more than
#   100 runs refuses rather than being read across pages. No `--paginate` — it concatenates page
#   bodies into a stream that is not one JSON document, and an explicit refusal is worth more here
#   than a multi-request read that has to be got right.
#
# Both belong to the request, so a fixture that only proves a request REACHED the resource proves
# nothing about either; `infra-tests.sh` records the raw query and serves a deliberately narrowed
# body to any request that omits `filter=all`.
if [ -n "$EXPECTED_HEAD" ]; then
  if runs="$("$GH" api "repos/$REPO/commits/$EXPECTED_HEAD/check-runs?filter=all&per_page=100" 2>&1)"; then
    summary="$(printf '%s' "$runs" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        const bad = () => process.stdout.write("MALFORMED");
        try {
          const o = JSON.parse(s);
          const list = o?.check_runs;
          if (!Array.isArray(list)) return bad();
          // A response that does not say how many runs exist cannot be shown to be complete, and an
          // incomplete list is the one input that turns "newest wins" into a false pass. The real
          // endpoint always sends `total_count`; a body without it is a shape this script will not
          // guess about, and a count SMALLER than the array is metadata that cannot be true.
          if (!Number.isInteger(o.total_count) || o.total_count < 0) return bad();
          if (o.total_count > list.length) return process.stdout.write("TRUNCATED");
          if (o.total_count < list.length) return bad();
          // Every value that reaches the tab-separated record below is delimiter-checked. G-OTHER,
          // 2026-09-10 (#186 review): a `conclusion` of "success\tanything" would otherwise be read
          // back as `success` by `cut -f3`. Real conclusions are an enum, so this can only be an
          // unexpected shape — and an unexpected shape refuses.
          const clean = (v) => typeof v === "string" && !/[\t\r\n]/.test(v);
          const groups = new Map();
          for (const r of list) {
            if (!r || !clean(r.name) || !clean(r.status)) return bad();
            if (r.conclusion != null && !clean(r.conclusion)) return bad();
            for (const u of [r.html_url, r.details_url]) if (u != null && !clean(u)) return bad();
            if (r.started_at != null && !clean(r.started_at)) return bad();
            if (!groups.has(r.name)) groups.set(r.name, []);
            groups.get(r.name).push(r);
          }
          // G2, 2026-09-10 (#186 review). #180 asked the refusal to name WHICH run failed, and a
          // count of alternatives is not a name: an operator reading `newest of 3 runs` still has to
          // reconstruct the selection by hand. Every verdict now carries the deciding run — its id,
          // its start and its page — and every refusal carries the runs that caused it.
          const rid = (r) => {
            const id = Number.isInteger(r.id) ? `run ${r.id}` : "run (no id)";
            const at = clean(r.started_at) ? ` started ${r.started_at}` : " started (unknown)";
            const url = clean(r.html_url) ? ` ${r.html_url}` : (clean(r.details_url) ? ` ${r.details_url}` : "");
            return `${id}${at}${url}`;
          };
          const concl = (r) => (typeof r.conclusion === "string" ? r.conclusion : "");
          const out = [];
          for (const [name, rs] of groups) {
            const push = (verdict, detail, evidence) =>
              out.push(`${name}\t${verdict}\t${detail}\t${rs.length}\t${evidence}`);
            const unfinished = rs.filter((r) => r.status !== "completed");
            if (unfinished.length) {
              const detail = rs.length > 1
                ? `${unfinished[0].status} (${unfinished.length} of ${rs.length} runs of that name have not finished)`
                : unfinished[0].status;
              push("pending", detail, unfinished.map((r) => `${rid(r)} is ${r.status}`).join("; "));
              continue;
            }
            if (rs.length === 1) { push("completed", concl(rs[0]), rid(rs[0])); continue; }
            // G3, 2026-09-10 (#186 review). Beyond one run, the group is only comparable if the runs
            // came from the SAME source. GitHub can pin an expected app per required context; this
            // script reads context NAMES only, so it cannot tell a required provider from any other
            // app that happens to publish the same display name — and under newest-wins a newer
            // green from a stranger would then certify the required provider red. No cross-provider
            // collision has been observed on this repository (every run is app 15368), so this is a
            // bounded refusal rather than a policy engine: when the group is not provably one
            // source, it is not decided here.
            const apps = rs.map((r) => (Number.isInteger(r?.app?.id) ? r.app.id : null));
            if (apps.some((a) => a === null) || new Set(apps).size > 1) {
              push("ambiguous",
                `its ${rs.length} runs do not provably come from one source, so a newer run of one app could certify the failure of another`,
                rs.map((r, i) => `${rid(r)} from app ${apps[i] === null ? "(unreadable)" : apps[i]}`).join("; "));
              continue;
            }
            // More than one finished run: an order is now load-bearing, so it must be readable.
            const times = rs.map((r) => (clean(r.started_at) ? Date.parse(r.started_at) : NaN));
            const unreadable = rs.filter((_, i) => !Number.isFinite(times[i]));
            if (unreadable.length) {
              push("ambiguous",
                `started_at is missing or unparseable on ${unreadable.length} of ${rs.length} runs, so "newest" cannot be decided`,
                unreadable.map(rid).join("; "));
              continue;
            }
            const newestAt = Math.max(...times);
            const newest = rs.filter((_, i) => times[i] === newestAt);
            const distinct = [...new Set(newest.map(concl))];
            if (distinct.length > 1) {
              push("ambiguous",
                `${newest.length} runs are tied as newest at ${new Date(newestAt).toISOString()} and disagree (${distinct.map((c) => c || "(none)").join(", ")})`,
                newest.map((r) => `${rid(r)} concluded ${concl(r) || "(none)"}`).join("; "));
              continue;
            }
            const tied = newest.length > 1 ? `, tied with ${newest.length - 1} more at the same instant` : "";
            push("completed", distinct[0], `${rid(newest[0])}${tied}`);
          }
          process.stdout.write(out.join("\n"));
        } catch { bad(); }});' 2>/dev/null)"
    # One resolved line per distinct name, so `exit` stops at the only candidate there is.
    check_line() { printf '%s\n' "$summary" | awk -F'\t' -v n="$1" '$1==n{print; exit}'; }
    if [ "$summary" = "MALFORMED" ]; then
      # An unreadable list is UNKNOWN, never green — and never `absent` either, which would claim
      # to have read the response and found nothing in it.
      unavail checks.unreadable "the check runs at $EXPECTED_HEAD were returned in a shape this script does not recognise. Unreadable is not absent, and not a pass."
    elif [ "$summary" = "TRUNCATED" ]; then
      unavail checks.unreadable "the check runs at $EXPECTED_HEAD did not all fit in one page, so the newest run of a required name may not have been read at all. A partial list is not a pass."
    else
    for want in ${PROJECT_CHECKS[@]+"${PROJECT_CHECKS[@]}"}; do
      line="$(check_line "$want")"
      if [ -z "$line" ]; then
        refuse checks.absent "the project's required check \"$want\" has no run at $EXPECTED_HEAD"
        continue
      fi
      verdict="$(printf '%s' "$line" | cut -f2)"
      detail="$(printf '%s' "$line" | cut -f3)"
      count="$(printf '%s' "$line" | cut -f4)"
      evidence="$(printf '%s' "$line" | cut -f5)"
      # Every line names the run it read. A reader told "success" for a name that also has a red run
      # deserves both facts: that an order was applied, and WHICH run that order chose (G2).
      many=""
      [ "$count" = "1" ] || many=" (newest of $count runs of that name)"
      where=""
      [ -z "$evidence" ] || where=" — $evidence"
      if [ "$verdict" = "pending" ]; then
        refuse checks.pending "\"$want\" is $detail at $EXPECTED_HEAD$where. Pending is pending; it is never a pass."
      elif [ "$verdict" = "ambiguous" ]; then
        refuse checks.ambiguous "\"$want\" at $EXPECTED_HEAD: $detail$where. What cannot be decided is never a pass."
      elif [ "$verdict" != "completed" ]; then
        refuse checks.ambiguous "\"$want\" at $EXPECTED_HEAD resolved to \"$verdict\", which this script does not recognise."
      elif [ "$detail" = "success" ]; then
        observe "check $want: success$many$where"
      elif [ "$detail" = "skipped" ]; then
        # A credential-gated skip is a fourth word, reported as itself. It is never folded into
        # "all green", and it is never silently accepted for a check that is not allowed to skip.
        allowed=0
        for s in ${SKIP_ALLOWED[@]+"${SKIP_ALLOWED[@]}"}; do [ "$s" = "$want" ] && allowed=1; done
        if [ "$allowed" = 1 ]; then
          observe "check $want: SKIPPED (credential-gated; explicitly not a pass and not a failure)$many$where"
        else
          refuse checks.skipped "\"$want\" was skipped at $EXPECTED_HEAD and is not permitted to skip$many$where"
        fi
      else
        refuse checks.failed "\"$want\" concluded \"$detail\" at $EXPECTED_HEAD$many$where"
      fi
    done
    # Anything the branch rules enforce that is not in the project list is still required, and it is
    # resolved through the same grouping — a branch-enforced context has exactly the same
    # duplicate-runs problem, and reading it any other way would leave half of #180 unfixed.
    if [ -n "$required_contexts" ]; then
      while IFS= read -r ctx; do
        [ -n "$ctx" ] || continue
        known=0
        for want in ${PROJECT_CHECKS[@]+"${PROJECT_CHECKS[@]}"}; do [ "$want" = "$ctx" ] && known=1; done
        [ "$known" = 1 ] && continue
        line="$(check_line "$ctx")"
        if [ -z "$line" ] \
          || [ "$(printf '%s' "$line" | cut -f2)" != "completed" ] \
          || [ "$(printf '%s' "$line" | cut -f3)" != "success" ]; then
          ctx_why="$(printf '%s' "$line" | cut -f3)"
          ctx_where="$(printf '%s' "$line" | cut -f5)"
          refuse checks.branch-required "branch-enforced context \"$ctx\" is not successful at $EXPECTED_HEAD$([ -n "$line" ] && printf ' (%s)' "${ctx_why:-no run}")$([ -n "$ctx_where" ] && printf ' — %s' "$ctx_where")"
        fi
      done <<EOF
$required_contexts
EOF
    fi
    fi
  else
    unavail checks.unreadable "could not read check runs at $EXPECTED_HEAD: $(printf '%s' "$runs" | head -1)"
  fi
fi

# --- 8. Review and unresolved discussion ------------------------------------------------------
if reviews="$("$GH" api "repos/$REPO/pulls/$PR/reviews" 2>&1)"; then
  # GitHub's own computed review state, followed rather than approximated:
  #   - the LATEST submitted review per reviewer is the one that counts;
  #   - COMMENTED never changes a reviewer's state, so it is skipped rather than overwriting;
  #   - DISMISSED counts as neither an approval nor an objection — the review still exists, but it
  #     no longer approves, and treating it as approving is the classic stale-approval bug;
  #   - PENDING is an unsubmitted draft and never counts.
  # An approval is also bound to the commit it was given on (`commit_id`), so an approval of an
  # earlier push can be reported separately from one at the head under review.
  approved="$(printf '%s' "$reviews" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const head = process.argv[1];
        const rs = JSON.parse(s); const latest = new Map();
        for (const r of Array.isArray(rs)?rs:[]) {
          if (!r?.user?.login) continue;
          if (r.state === "COMMENTED" || r.state === "PENDING") continue;
          latest.set(r.user.login, r);
        }
        let ok = 0, changes = 0, stale = 0;
        for (const r of latest.values()) {
          if (r.state === "CHANGES_REQUESTED") { changes++; continue; }
          if (r.state !== "APPROVED") continue;            // DISMISSED and anything else
          if (head && r.commit_id && r.commit_id !== head) { stale++; continue; }
          ok++;
        }
        process.stdout.write(`${ok} ${changes} ${stale}`);
      } catch { process.stdout.write(""); }});' "$EXPECTED_HEAD" 2>/dev/null)"
  ok_count="$(printf '%s' "$approved" | cut -d' ' -f1)"
  changes_count="$(printf '%s' "$approved" | cut -d' ' -f2)"
  stale_count="$(printf '%s' "$approved" | cut -d' ' -f3)"
  if [ -z "$approved" ]; then
    unavail review.unparsed "could not interpret the review list for PR #$PR"
  else
    observe "reviews: $ok_count approving at $EXPECTED_HEAD, $changes_count requesting changes, ${stale_count:-0} approving an EARLIER commit (latest submitted review per reviewer; COMMENTED and PENDING ignored, DISMISSED counts as neither)"
    #
    # F-A6, 2026-09-09 (#116 review). This used to demand `ok_count >= 1` unconditionally, which is
    # UNSATISFIABLE here and blocked every normal pull request. On this repository the effective
    # `pull_request` rule on `main` sets `required_approving_review_count: 0`; the workflow is
    # solo, so the same account authors every PR; and GitHub does not permit approving your own.
    # PRs #118, #119 and #120 all merged with zero GitHub reviews. The real review route is an
    # independent Xezar PASS report plus explicit leader acceptance, recorded in the authority file.
    #
    # This is NOT a waiver. The requirement is DERIVED from policy instead of assumed:
    #   - policy says N > 0  -> N approving reviews are required, and enforced below;
    #   - policy says 0      -> zero approvals is compliant, and everything else still applies;
    #   - policy unreadable  -> UNKNOWN, reported as incomplete. Never treated as zero.
    # A changes-requested review still blocks at any N, including 0: policy sets a floor on
    # approvals, it never converts an outstanding objection into a non-event.
    if [ "$REQUIRED_REVIEWS" = "unknown" ]; then
      unavail review.policy-unknown "the approving-review requirement for $BASE could not be determined, so whether PR #$PR has enough approvals is UNKNOWN. An unread policy is not a policy of zero."
    elif [ "${ok_count:-0}" -lt "$REQUIRED_REVIEWS" ]; then
      if [ "${stale_count:-0}" -gt 0 ]; then
        refuse review.stale "PR #$PR has ${ok_count:-0} approving review(s) at $EXPECTED_HEAD but ${stale_count} approving an EARLIER commit; policy for $BASE requires $REQUIRED_REVIEWS. An approval of a revision nobody is merging is not an approval of this one."
      else
        refuse review.insufficient "PR #$PR has ${ok_count:-0} approving review(s); policy for $BASE requires $REQUIRED_REVIEWS."
      fi
    elif [ "$REQUIRED_REVIEWS" -eq 0 ]; then
      observe "policy for $BASE requires 0 approving reviews, and ${ok_count:-0} are present — compliant. The review that matters here is the independent report named in the authority record, not a GitHub approval."
    else
      observe "policy for $BASE requires $REQUIRED_REVIEWS approving review(s); ${ok_count:-0} present"
    fi
    [ "${changes_count:-0}" -eq 0 ] || refuse review.changes-requested "PR #$PR has $changes_count reviewer(s) requesting changes"
  fi
else
  unavail review.unreadable "could not read reviews for PR #$PR: $(printf '%s' "$reviews" | head -1)"
fi

if threads="$("$GH" api "repos/$REPO/pulls/$PR/comments" 2>&1)"; then
  unresolved="$(printf '%s' "$threads" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const cs = JSON.parse(s);
        process.stdout.write(String((Array.isArray(cs)?cs:[]).filter(c=>c && c.in_reply_to_id == null && c.position != null).length));
      } catch { process.stdout.write(""); }});' 2>/dev/null)"
  [ -n "$unresolved" ] && observe "open review comment threads: $unresolved (a count, not a resolution judgement)"
else
  unavail discussions.unreadable "could not read review comments for PR #$PR"
fi

# --- 9. Local sealed evidence for this exact head ------------------------------------------------
if [ -x "$SCRIPT_DIR/verify-evidence.sh" ] && [ -n "$EXPECTED_HEAD" ]; then
  observe "local evidence: audit with .xezar/checks/verify-evidence.sh <runId> --require-current (separate, read-only)"
fi

# --- Verdict -----------------------------------------------------------------------------------
printf '=== integration preflight ===\n'
printf '  repo          %s\n' "$REPO"
printf '  pr            #%s\n' "$PR"
printf '  base          %s\n' "$BASE"
printf '  expected head %s\n' "$EXPECTED_HEAD"
printf '  authority     %s%s\n' "$AUTHORITY" "$([ "$authority_present" = 1 ] && printf ' (present)' || printf ' (ABSENT)')"
[ -n "$ISSUE" ] && printf '  issue         #%s (closure requested)\n' "$ISSUE"

if [ ${#observations[@]} -gt 0 ]; then
  printf '\nObserved:\n'
  for o in "${observations[@]}"; do printf '  - %s\n' "$o"; done
fi
if [ ${#unavailable[@]} -gt 0 ]; then
  printf '\nUNAVAILABLE — could not be determined. Unavailable is not absent, and not a pass:\n'
  for u in "${unavailable[@]}"; do printf '  - %s\n' "$u"; done
fi
if [ ${#refusals[@]} -gt 0 ]; then
  printf '\nREFUSED (%d):\n' "${#refusals[@]}"
  for r in "${refusals[@]}"; do printf '  - %s\n' "$r"; done
  printf '\nINTEGRATION PREFLIGHT REFUSED — do not merge.\n'
  exit 1
fi
if [ ${#unavailable[@]} -gt 0 ]; then
  printf '\nINTEGRATION PREFLIGHT INCOMPLETE — one or more preconditions could not be read.\n'
  printf 'An unread precondition is not a satisfied one. Report it and stop; do not merge.\n'
  exit 1
fi

printf '\nINTEGRATION PREFLIGHT OK — every named precondition holds at %s.\n' "$EXPECTED_HEAD"
printf 'This is an OBSERVATION, not permission. It says the facts line up; it says nothing about\n'
printf 'whether whoever wrote %s was entitled to. Authority is carried, never verified here.\n' "$AUTHORITY"
exit 0
