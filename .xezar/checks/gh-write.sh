#!/usr/bin/env bash
# The only way a reading role writes to the tracker.
#
# A reading step's `bashAllowlist` is a list of command prefixes, and a prefix limits the program,
# never what it does: `gh pr comment` also takes `--edit-last`, `--delete-last`, `-R <any repo>`
# and `-F <any local file>`, and `gh pr edit` can add `qa-approved` or remove `do-not-merge`. So a
# reading step is not allowed those commands. It is allowed this script, which does two things,
# always on this checkout's own `origin` repository:
#
#   gh-write.sh comment pr|issue <number>            post a NEW comment; the text comes on stdin
#   gh-write.sh label pr|issue <number> --add <l>… --remove <l>…
#   gh-write.sh                                      either one, as one JSON request on stdin:
#     {"action":"comment","kind":"pr","number":12,"body":"…"}
#     {"action":"label","kind":"pr","number":12,"add":["…"],"remove":["…"]}
#
# Use the last form from a pipe: the engine's shared read-only lock (pi, Codex) allows one pipe
# only into an argument-free `bash <script>`, so `jq -n '{…,body:"…"}' | bash
# .xezar/checks/gh-write.sh` passes on every runner and `… | gh-write.sh comment pr 12` does not.
# Keep every `$` out of the command: Claude Code denies a command holding one in a reading step,
# so the text goes in the filter as a JSON string (`\u0024` for a dollar sign), never `--arg`.
#
# A label change never adds an approval label and never removes a label that blocks a merge: those
# are the labels `lib/project-policy.mjs` trusts, and a reviewer that could move them would be
# passing the merge gate on its own word. Build the request with `jq -n`, never a heredoc or
# `printf`, which no reading step's allowlist holds.
#
# Exit: gh's own status on a run, 1 on a refusal, 2 on usage.
set -uo pipefail

# Labels a reader may never add, and labels it may never remove (lib/project-policy.mjs).
NEVER_ADD="qa-approved qa-self-verified design-approved skip-qa skip-design"
NEVER_REMOVE="blocked do-not-merge qa qa-failed design design-failed needs-qa needs-design"
COMMENT_MAX_BYTES=65536

usage() {
  echo "usage: gh-write.sh comment pr|issue <number>   (text on stdin)" >&2
  echo "       gh-write.sh label pr|issue <number> [--add <label>]… [--remove <label>]…" >&2
  echo "       gh-write.sh                               (one JSON request on stdin)" >&2
  exit 2
}

refuse() {
  echo "gh-write.sh: refused: $*" >&2
  exit 1
}

has_word() {
  case " $2 " in *" $1 "*) return 0 ;; esac
  return 1
}

# owner/repo of `origin`, from an https or ssh GitHub URL. Anything else is refused: the target
# repository is never taken from an argument.
origin_repo() {
  local url slug
  url="$(git remote get-url origin 2>/dev/null)" || refuse "this checkout has no origin remote"
  case "$url" in
    https://github.com/*) slug="${url#https://github.com/}" ;;
    git@github.com:*) slug="${url#git@github.com:}" ;;
    ssh://git@github.com/*) slug="${url#ssh://git@github.com/}" ;;
    *) refuse "origin is not a GitHub repository" ;;
  esac
  slug="${slug%.git}"
  printf '%s' "$slug" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' || refuse "origin does not name owner/repo"
  printf '%s' "$slug"
}

# The JSON form becomes the same arguments, so one set of checks below covers both forms.
json_body=""
if [ $# -eq 0 ]; then
  request="$(head -c $((COMMENT_MAX_BYTES + 4096)))" || refuse "could not read stdin"
  [ "${#request}" -le $((COMMENT_MAX_BYTES + 4095)) ] || refuse "the request is too large"
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$request" || refuse "stdin is not one JSON request object"
  field() { jq -r --arg k "$1" 'if (.[$k] | type) == "string" or (.[$k] | type) == "number" then .[$k] | tostring else "" end' <<<"$request"; }
  j_action="$(field action)"
  set -- "$j_action" "$(field kind)" "$(field number)"
  case "$j_action" in
    comment)
      jq -e '(.body | type) == "string"' >/dev/null <<<"$request" || refuse "a comment request needs a string body"
      json_body="$(jq -r '.body' <<<"$request")"
      ;;
    label)
      jq -e '[(.add // []), (.remove // [])] | all(type == "array" and all(.[]; type == "string"))' >/dev/null <<<"$request" ||
        refuse "add and remove must be lists of label names"
      while IFS= read -r l; do [ -n "$l" ] && set -- "$@" --add "$l"; done < <(jq -r '(.add // [])[]' <<<"$request")
      while IFS= read -r l; do [ -n "$l" ] && set -- "$@" --remove "$l"; done < <(jq -r '(.remove // [])[]' <<<"$request")
      ;;
  esac
  from_json=1
fi

[ $# -ge 3 ] || usage
action="$1"
kind="$2"
number="$3"
shift 3

case "$kind" in pr | issue) ;; *) usage ;; esac
printf '%s' "$number" | grep -Eq '^[1-9][0-9]{0,9}$' || refuse "\"$number\" is not a $kind number"
repo="$(origin_repo)" || exit 1

case "$action" in
  comment)
    [ $# -eq 0 ] || usage
    if [ -n "${from_json:-}" ]; then
      body="$json_body"
    else
      body="$(head -c $((COMMENT_MAX_BYTES + 1)))" || refuse "could not read stdin"
    fi
    [ -n "$body" ] || refuse "the comment on stdin is empty"
    [ "${#body}" -le "$COMMENT_MAX_BYTES" ] || refuse "the comment is over $COMMENT_MAX_BYTES bytes"
    printf '%s' "$body" | gh "$kind" comment "$number" --repo "$repo" --body-file -
    ;;
  label)
    [ $# -ge 2 ] || usage
    args=()
    while [ $# -gt 0 ]; do
      flag="$1"
      label="${2:-}"
      [ -n "$label" ] || usage
      printf '%s' "$label" | grep -Eq '^[a-z0-9][a-z0-9-]{0,49}$' || refuse "\"$label\" is not a label name"
      case "$flag" in
        --add)
          has_word "$label" "$NEVER_ADD" && refuse "\"$label\" is an approval label; a reviewer never grants it"
          args+=(--add-label "$label")
          ;;
        --remove)
          has_word "$label" "$NEVER_REMOVE" && refuse "\"$label\" blocks a merge; a reviewer never lifts it"
          args+=(--remove-label "$label")
          ;;
        *) usage ;;
      esac
      shift 2
    done
    gh "$kind" edit "$number" --repo "$repo" "${args[@]}"
    ;;
  *) usage ;;
esac
