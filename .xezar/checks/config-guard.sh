#!/usr/bin/env bash
# Refuses a guarded workflow before anything is paid for, when the project never configured it.
#
# Some workflows only make sense in a project that has said something first: a deploy needs an
# environment, a performance verdict needs a budget, a locale needs to be on the list. They are
# installed everywhere — a project that gains a deploy next month should find the workflow already
# there — so the question "is this one awake here?" is asked at run time, by this script, as the
# step BEFORE `setup`. `setup` is a full dependency install; refusing after it means minutes of
# work to learn that this project has no deploy.
#
#   config-guard.sh <key> [--from-base]
#
# Four answers, and the two refusals that matter are different sentences on purpose:
#   ok         exit 0   the list is there and every entry is the right shape
#   empty      exit 1   the key is `[]`: the owner's honest "this project has none"
#   absent     exit 1   the key is not set at all
#   malformed  exit 2   a misspelt key, a wrong type, an entry of the wrong shape
# A typo must never read as "none configured". The grammar lives in lib/config-grammar.mjs.
#
# --from-base reads the config from `origin/<base branch>` instead of this checkout, and for the
# `deploy.*` keys also requires each named workflow file to exist THERE with a
# `workflow_dispatch` trigger. A deploy target is a trust boundary: a branch under review must
# not be able to repoint `production=` at a workflow file it adds itself.
#
# WHICH branch is "the base" is part of that boundary, so under --from-base it is NOT taken from
# this checkout's `.xezar/config.json`: that file is committed, and a branch that may edit the
# deploy list may edit `baseBranch` beside it and name itself the base. The base is the remote's
# own default branch (`refs/remotes/origin/HEAD`), and a config that disagrees with it is refused
# by name rather than believed. The name is validated before it reaches a git argument: git
# parses options after the remote name, so an unvalidated branch name is an option injection.
#
#   config-guard.sh browser --from-base
#
# The ad-hoc browser (`chrome-devtools` in `.mcp.json` and `.codex/config.toml`) runs outside
# every runner sandbox with the operator's file and network reach, so its entry — command, args,
# tools — is refused here (exit 1) when it differs from the one the base branch already carries.
# Such a change needs a security review and a human merge. A base with no entry yet is the setup
# or upgrade pull request, which the security-review row already takes.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

KEY="${1:-}"
FROM_BASE=0
[ "${2:-}" = "--from-base" ] && FROM_BASE=1
if [ -z "$KEY" ]; then
  printf 'config-guard: usage: config-guard.sh <key> [--from-base]\n' >&2
  exit 2
fi
if ! resolve_task_paths; then
  printf 'config-guard: cannot resolve this checkout\n' >&2
  exit 2
fi

CFG_REL=".xezar/pipeline/config.json"
if [ "$KEY" = "browser" ] && [ "$FROM_BASE" -eq 0 ]; then
  printf 'config-guard: usage: config-guard.sh browser --from-base (the browser entry is compared with the base branch only)\n' >&2
  exit 2
fi
if [ "$FROM_BASE" -eq 1 ]; then
  REMOTE_DEFAULT="$(git -C "$TASK_CWD" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)" || REMOTE_DEFAULT=""
  REMOTE_DEFAULT="${REMOTE_DEFAULT#origin/}"
  if [ -z "$REMOTE_DEFAULT" ]; then
    printf 'config-guard: malformed — the remote default branch is unknown here (refs/remotes/origin/HEAD is not set), and the base is never taken from this checkout alone. Run: git remote set-head origin --auto\n' >&2
    exit 2
  fi
  if ! printf '%s' "$REMOTE_DEFAULT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$'; then
    printf 'config-guard: malformed — the remote default branch name is not a plain branch name\n' >&2
    exit 2
  fi
  if [ "$BASE_BRANCH" != "$REMOTE_DEFAULT" ]; then
    printf 'config-guard: malformed — this checkout says the base branch is "%s" and the remote says "%s". A deploy list is trusted from the remote default branch only; a checkout that names another base is refused, not believed.\n' "$BASE_BRANCH" "$REMOTE_DEFAULT" >&2
    exit 2
  fi
  BASE_BRANCH="$REMOTE_DEFAULT"
  SOURCE_NAME="origin/$BASE_BRANCH:$CFG_REL"
  git -C "$TASK_CWD" fetch --quiet origin "refs/heads/$BASE_BRANCH:refs/remotes/origin/$BASE_BRANCH" 2>/dev/null || true
  if [ "$KEY" = "browser" ]; then
    for file in .mcp.json .codex/config.toml; do
      # Both texts go in as DATA (environment), never spliced into the script.
      SAME="$(BASE_TEXT="$(git -C "$TASK_CWD" show "origin/$BASE_BRANCH:$file" 2>/dev/null)" \
        TREE_TEXT="$(cat "$TASK_CWD/$file" 2>/dev/null)" node -e '
        const entry = (text) => {
          if (!text) return "";
          if (process.argv[1].endsWith(".json")) {
            const found = JSON.parse(text).mcpServers?.["chrome-devtools"];
            return found === undefined ? "" : JSON.stringify(found);
          }
          // TOML: every table under mcp_servers.chrome-devtools, plus any line naming it elsewhere.
          let inside = false;
          return text.split("\n").map((line) => line.trim()).filter((line) => {
            if (line.startsWith("[")) inside = /^\[\s*mcp_servers\.("?)chrome-devtools\1\s*[.\]]/.test(line);
            return line !== "" && !line.startsWith("#") && (inside || line.includes("chrome-devtools"));
          }).join("\n");
        };
        try {
          const base = entry(process.env.BASE_TEXT);
          console.log(base === "" || base === entry(process.env.TREE_TEXT) ? "same" : "changed");
        } catch { console.log("unreadable"); }
      ' "$file")"
      case "$SAME" in
        same) ;;
        changed)
          printf 'config-guard: refused — the chrome-devtools entry in %s differs from origin/%s. A change to the browser'"'"'s command, args or tools needs a security review and a human merge, never this gate.\n' "$file" "$BASE_BRANCH" >&2
          exit 1 ;;
        *)
          printf 'config-guard: malformed — %s cannot be read here or on origin/%s, so the chrome-devtools entry cannot be compared\n' "$file" "$BASE_BRANCH" >&2
          exit 2 ;;
      esac
    done
    printf 'config-guard: ok — browser: the chrome-devtools entry matches origin/%s (.mcp.json, .codex/config.toml)\n' "$BASE_BRANCH"
    exit 0
  fi
  CFG_TEXT="$(git -C "$TASK_CWD" show "origin/$BASE_BRANCH:$CFG_REL" 2>/dev/null)" || {
    printf 'config-guard: malformed — cannot read %s; the base branch is where this key is trusted from\n' "$SOURCE_NAME" >&2
    exit 2
  }
else
  SOURCE_NAME="$CFG_REL"
  if [ ! -e "$TASK_CWD/$CFG_REL" ]; then
    printf 'config-guard: absent — %s does not exist, so "%s" is not set\n' "$CFG_REL" "$KEY" >&2
    exit 1
  fi
  # It exists and cannot be read: that is a fault, not the owner's answer.
  CFG_TEXT="$(cat "$TASK_CWD/$CFG_REL" 2>/dev/null)" || {
    printf 'config-guard: malformed — %s exists and cannot be read\n' "$CFG_REL" >&2
    exit 2
  }
fi

# The grammar module's path is passed as DATA. Spliced into the source, a checkout path holding
# a quote would become code inside the script that is meant to be the boundary.
VERDICT="$(printf '%s' "$CFG_TEXT" | node --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const { judge } = await import(pathToFileURL(process.argv[2]).href);
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  let config;
  try { config = JSON.parse(text); } catch { console.log("malformed\tnot valid JSON"); process.exit(0); }
  const result = judge(config, process.argv[1]);
  console.log(`${result.status}\t${result.detail}`);
  for (const value of result.values) console.log(value);
' "$KEY" "$SCRIPT_DIR/lib/config-grammar.mjs")" || {
  printf 'config-guard: malformed — the grammar check itself could not run; an unknown answer is never a pass\n' >&2
  exit 2
}

STATUS="$(printf '%s\n' "$VERDICT" | sed -n '1p' | cut -f1)"
DETAIL="$(printf '%s\n' "$VERDICT" | sed -n '1p' | cut -f2-)"

case "$STATUS" in
  ok) ;;
  empty)
    printf 'config-guard: empty — %s in %s. This project has said it has none, so this workflow does not run here. To wake it, fill the list.\n' "$DETAIL" "$SOURCE_NAME" >&2
    exit 1 ;;
  absent)
    printf 'config-guard: absent — %s in %s. Nobody has answered this for this project yet; set the key, or set it to [] to say there is none.\n' "$DETAIL" "$SOURCE_NAME" >&2
    exit 1 ;;
  *)
    printf 'config-guard: malformed — %s (%s). This is a fault in the config, not a project with none.\n' "$DETAIL" "$SOURCE_NAME" >&2
    exit 2 ;;
esac

# A deploy target must be a dispatchable workflow that exists on the base branch.
if [ "$FROM_BASE" -eq 1 ]; then
  case "$KEY" in
    deploy.*)
      while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        file="${entry#*=}"
        body="$(git -C "$TASK_CWD" show "origin/$BASE_BRANCH:.github/workflows/$file" 2>/dev/null)" || {
          printf 'config-guard: malformed — %s names %s, and origin/%s has no .github/workflows/%s\n' "$KEY" "$entry" "$BASE_BRANCH" "$file" >&2
          exit 2
        }
        printf '%s\n' "$body" | grep -Eq '^[[:space:]]*workflow_dispatch[[:space:]]*:' || {
          printf 'config-guard: malformed — %s on origin/%s has no workflow_dispatch trigger, so nothing here can start it\n' "$file" "$BASE_BRANCH" >&2
          exit 2
        }
      done <<LIST
$(printf '%s\n' "$VERDICT" | sed '1d')
LIST
      ;;
  esac
fi

printf 'config-guard: ok — %s: %s (%s)\n' "$KEY" "$DETAIL" "$SOURCE_NAME"
