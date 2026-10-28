#!/usr/bin/env bash
# Turns a written deploy authority into a permit to dispatch — once — or refuses.
#
# The deploy role's rules used to be sentences: "one record permits one dispatch", "run the
# rollback guard yourself", "confirm the commit". A sentence is what an agent under pressure, or
# an agent reading hostile text, stops following. So everything that can be checked by a machine
# is checked HERE, in a check step between the agent that writes the authority and the agent that
# dispatches. The dispatching agent gets a permit file naming the exact command; without one, the
# run has already ended.
#
#   <evidence>/deploy/authority.json   written by the `authorise` step — what the owner said
#   <evidence>/deploy/permit.json      written here — what may be dispatched, exactly once
#
# What it refuses, in order:
#   - a BLOCKED file, or no authority record: the authorise step could not establish one
#   - an authority record of the wrong shape, or one whose source is not the launch text
#   - a permit that already exists: this authority was used. AT MOST ONCE — a crashed dispatch is
#     a new run and a new go, never a silent second attempt
#   - the deploy list for this DIRECTION, read from the remote default branch (config-guard.sh)
#   - an environment that list does not name
#   - a workflow that declares no `sha` input. `gh workflow run --ref` takes a branch or a tag,
#     never a commit, and the ref also decides WHICH VERSION of the workflow file runs. So the ref
#     is always the base branch — the reviewed workflow — and the commit travels as data.
#   - a commit that is not on the base branch's history: only what was merged is deployed
#   - a rollback across a migration marked one-way, unless the authority record names it. The
#     migration role commits one page per migration under `paths.migrations`, carrying a line
#     `reversibility: one-way` when the data cannot come back. Every such page ADDED to the base
#     branch after the rollback target is a move the old code may not be able to read. This
#     over-counts on purpose — a page merged and not yet deployed is counted too — because the
#     wrong direction here is rolling old code onto new data.
#
# Exit 0 = permit written. Exit 1 = refused for a reason the owner can fix by saying more.
# Exit 2 = a fault. Both end the run before anything is dispatched.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

refuse() { printf 'deploy-guard: refused — %s\n' "$1" >&2; exit 1; }
fault() { printf 'deploy-guard: fault — %s\n' "$1" >&2; exit 2; }

resolve_task_paths || fault "cannot resolve this checkout"
EVIDENCE_DIR="$(task_evidence_dir)" || fault "could not resolve the evidence directory"
AUTHORITY="$EVIDENCE_DIR/deploy/authority.json"
PERMIT="$EVIDENCE_DIR/deploy/permit.json"

[ ! -e "$EVIDENCE_DIR/BLOCKED" ] || refuse "the authorise step wrote BLOCKED: $(head -c 400 "$EVIDENCE_DIR/BLOCKED" | tr '\n' ' ')"
[ -r "$AUTHORITY" ] || refuse "no authority record at $AUTHORITY — nothing is dispatched on a go nobody wrote down"
[ ! -e "$PERMIT" ] || refuse "a permit already exists at $PERMIT — this authority was used. One record permits one dispatch; a second needs a new run and a new go"

FIELDS="$(node -e '
  const fs = require("node:fs");
  let a;
  try { a = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.log("not valid JSON"); process.exit(3); }
  const bad = (m) => { console.log(m); process.exit(3); };
  if (a === null || typeof a !== "object" || Array.isArray(a)) bad("not a JSON object");
  if (a.direction !== "deploy" && a.direction !== "rollback") bad("direction must be deploy or rollback");
  if (typeof a.environment !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(a.environment)) bad("environment is not a plain environment name");
  if (typeof a.sha !== "string" || !/^[0-9a-f]{40}$/.test(a.sha)) bad("sha must be the full 40-character commit");
  if (typeof a.authorisedBy !== "string" || !a.authorisedBy.trim()) bad("authorisedBy is empty");
  if (typeof a.words !== "string" || !a.words.trim()) bad("words is empty — the record quotes what was said");
  if (a.source !== "launch") bad("source must be \"launch\": the text this run was started with is the only authority a deploy accepts");
  const across = a.acrossOneWay === undefined ? [] : a.acrossOneWay;
  if (!Array.isArray(across) || across.some((p) => typeof p !== "string")) bad("acrossOneWay must be a list of migration page paths");
  process.stdout.write([a.direction, a.environment, a.sha, across.join("\u001f")].join("\n"));
' "$AUTHORITY")" || refuse "the authority record is not usable: $FIELDS"

DIRECTION="$(printf '%s\n' "$FIELDS" | sed -n '1p')"
ENVIRONMENT="$(printf '%s\n' "$FIELDS" | sed -n '2p')"
SHA="$(printf '%s\n' "$FIELDS" | sed -n '3p')"
ACROSS="$(printf '%s\n' "$FIELDS" | sed -n '4p' | tr '\037' '\n')"

if [ "$DIRECTION" = "rollback" ]; then KEY="deploy.rollback"; else KEY="deploy.environments"; fi

# The list for THIS direction, from the remote default branch. config-guard.sh prints its own
# reason; its exit status is kept as it is.
GUARD_OUT="$(bash "$SCRIPT_DIR/config-guard.sh" "$KEY" --from-base 2>&1)"
GUARD_STATUS=$?
printf '%s\n' "$GUARD_OUT"
[ "$GUARD_STATUS" -eq 0 ] || exit "$GUARD_STATUS"

BASE="$(git -C "$TASK_CWD" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)" || BASE=""
BASE="${BASE#origin/}"
[ -n "$BASE" ] || fault "the remote default branch is unknown"

WORKFLOW="$(git -C "$TASK_CWD" show "origin/$BASE:.xezar/pipeline/config.json" 2>/dev/null | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const [key, environment] = process.argv.slice(1);
    let node = JSON.parse(raw);
    for (const part of key.split(".")) node = node?.[part];
    const hit = (Array.isArray(node) ? node : []).find((e) => typeof e === "string" && e.split("=")[0] === environment);
    process.stdout.write(hit ? hit.slice(hit.indexOf("=") + 1) : "");
  });
' "$KEY" "$ENVIRONMENT" 2>/dev/null)" || WORKFLOW=""
[ -n "$WORKFLOW" ] || refuse "\"$ENVIRONMENT\" is not an environment $KEY lists on origin/$BASE — never an environment the owner's config does not name"

# The commit travels as an input, so the workflow has to declare one.
git -C "$TASK_CWD" show "origin/$BASE:.github/workflows/$WORKFLOW" 2>/dev/null \
  | grep -Eq '^[[:space:]]+sha[[:space:]]*:' \
  || refuse "$WORKFLOW on origin/$BASE declares no \`sha\` input. A dispatch names a branch, never a commit, so the workflow must take the commit as an input named \`sha\`, check that commit out, and deploy it"

git -C "$TASK_CWD" cat-file -e "$SHA^{commit}" 2>/dev/null \
  || refuse "commit $SHA is not in this repository — fetch it, or check the SHA"
git -C "$TASK_CWD" merge-base --is-ancestor "$SHA" "origin/$BASE" 2>/dev/null \
  || refuse "commit $SHA is not on the history of origin/$BASE. Only what was merged is deployed"

REF_SHA="$(git -C "$TASK_CWD" rev-parse "origin/$BASE" 2>/dev/null)" || fault "cannot read origin/$BASE"

if [ "$DIRECTION" = "rollback" ]; then
  MIGRATIONS="$(git -C "$TASK_CWD" show "origin/$BASE:.xezar/pipeline/config.json" 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      const dir = JSON.parse(raw)?.paths?.migrations;
      process.stdout.write(typeof dir === "string" && /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(dir) && !dir.includes("..") ? dir : "");
    });
  ' 2>/dev/null)" || MIGRATIONS=""
  if [ -z "$MIGRATIONS" ]; then
    printf 'deploy-guard: NOTE — paths.migrations is not set on origin/%s, so one-way migrations cannot be checked here. The owner carries that risk for this rollback.\n' "$BASE"
  else
    while IFS= read -r page; do
      [ -n "$page" ] || continue
      git -C "$TASK_CWD" show "origin/$BASE:$page" 2>/dev/null | grep -Eiq '^reversibility:[[:space:]]*one-way[[:space:]]*$' || continue
      printf '%s\n' "$ACROSS" | grep -Fxq "$page" \
        || refuse "rolling back to $SHA crosses a migration marked one-way: $page. The old code may not read the moved data. If the owner accepts that, the authority record names the page under acrossOneWay, in their words"
      printf 'deploy-guard: crossing one-way migration %s — named in the authority record\n' "$page"
    done <<PAGES
$(git -C "$TASK_CWD" diff --name-only --diff-filter=A "$SHA" "origin/$BASE" -- "$MIGRATIONS" 2>/dev/null)
PAGES
  fi
fi

mkdir -p "$EVIDENCE_DIR/deploy" || fault "cannot create $EVIDENCE_DIR/deploy"
node -e '
  const fs = require("node:fs");
  const [file, direction, environment, sha, workflow, ref, refSha] = process.argv.slice(1);
  const body = { direction, environment, sha, workflow, ref, refSha, permittedAt: new Date().toISOString() };
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(body, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(`${file}.tmp`, file);
' "$PERMIT" "$DIRECTION" "$ENVIRONMENT" "$SHA" "$WORKFLOW" "$BASE" "$REF_SHA" \
  || fault "could not write the permit — nothing may be dispatched without it"

printf 'deploy-guard: permitted — %s of %s to "%s"\n' "$DIRECTION" "$SHA" "$ENVIRONMENT"
printf '  dispatch exactly this, once:\n'
printf '    gh workflow run %s --ref %s -f sha=%s\n' "$WORKFLOW" "$BASE" "$SHA"
printf '  the run it creates has headSha %s (the tip of %s), event workflow_dispatch\n' "$REF_SHA" "$BASE"
printf '  permit: %s\n' "$PERMIT"
