#!/usr/bin/env bash
# Structural check for CHANGELOG.md. Exists because two fix PRs (#23, #26) each added their own
# `# Unreleased` section in different places, and the 0.11.1 release had to consolidate them by
# hand (issue #31). Nothing else in the repository looks at the heading structure.
#
# Refuses when:
#   - more than one `# Unreleased` heading exists;
#   - an `# Unreleased` heading sits BELOW a dated release heading `# <semver> (`, which breaks
#     the reverse-chronological order (newest first);
#   - with --require-version <v>: any `# Unreleased` heading remains, or the count of
#     `# <v> (` headings is not exactly one;
#   - with --diff-base <ref|auto>: the `# Unreleased` section was edited directly, its heading is
#     still there, AND the section at HEAD still differs from the section at the diff base
#     (issue #668). A pull request writes changelog.d/<pr-or-branch>.md instead, so two pull
#     requests never edit the same lines; removing the heading IS the release fold and stays
#     allowed, and so does reverting a direct edit and moving the bullet into a fragment. A diff
#     that touches anything else is untouched by this rule.
#   - with --fragments <dir>: a changelog fragment does not parse (see changelog-fragments.mjs).
#
# Only top-level `# ` headings count. `## ...` group headings and prose that mention the word
# are ignored, and a fenced code block never contains a heading this check would read as one.
# Both fence markers are honoured — ``` and ~~~, matching changelog-fragments.mjs (issue #698).
#
# Read-only. Exit 0 on pass, 1 on a structural failure, 2 on bad usage or a missing file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

usage() {
  cat <<'EOF'
usage: changelog-check.sh [--file <path>] [--require-version <semver>]
                          [--diff-base <ref|auto>] [--fragments <dir>]

  --file <path>              the changelog to check (default: CHANGELOG.md in the CWD)
  --require-version <semver> also require exactly one "# <semver> (" heading and no "# Unreleased"
  --diff-base <ref|auto>     refuse a direct edit of the "# Unreleased" section that is still in
                             place at HEAD, relative to <ref>; "auto" resolves the gate base, then
                             origin/main, then main, and says so loudly when it cannot resolve one
  --fragments <dir>          parse every changelog.d fragment in <dir>
EOF
}

file="CHANGELOG.md"
require=""
diff_base=""
fragments=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) [ $# -ge 2 ] || { usage >&2; exit 2; }; file="$2"; shift 2 ;;
    --require-version) [ $# -ge 2 ] || { usage >&2; exit 2; }; require="$2"; shift 2 ;;
    --diff-base) [ $# -ge 2 ] || { usage >&2; exit 2; }; diff_base="$2"; shift 2 ;;
    --fragments) [ $# -ge 2 ] || { usage >&2; exit 2; }; fragments="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'changelog-check: unknown argument %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -n "$require" ] && ! printf '%s' "$require" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
  printf 'changelog-check: --require-version wants a semver like 0.11.2, got "%s"\n' "$require" >&2
  exit 2
fi
if [ ! -f "$file" ]; then
  printf 'changelog-check: %s does not exist\n' "$file" >&2
  exit 2
fi

fail=0
say() { printf 'changelog-check: %s\n' "$1" >&2; fail=1; }

# --- Direct `# Unreleased` edits (issue #668) ----------------------------------------------------
# The `# Unreleased` section is where every pull request used to append, so the first merge made
# every other open pull request conflict on those exact lines. A pull request now writes its own
# `changelog.d/<pr-or-branch>.md`; this refuses the old shape. The section text is compared as a
# whole, so adding, removing, reordering or re-wrapping a bullet is refused. Deleting the heading
# is the release fold and is allowed — the release role's own `--require-version` run is what then
# proves the fold produced a dated section.
#
# ONLY THE BRANCH'S OWN FIRST-PARENT NON-MERGE COMMITS are inspected, plus the working tree
# against HEAD. A merge that brings another branch's `# Unreleased` change into this one is not
# this branch editing it, and flagging that would be a false red on a task that merely merged the
# base — the exact failure mode `security-scan.sh`'s empty change set cost a re-run for.
#
# A PER-COMMIT EDIT IS ONLY HALF THE QUESTION (issue #668 review M2). The natural repair is to
# revert the changelog and move the bullet into a fragment, and a per-commit-only rule refuses
# that repair for good: the branch could only clear it by rewriting history, which the refusal
# never says and which a review-response round must not do. So the edit must ALSO still be visible
# at HEAD — when the `# Unreleased` region at HEAD equals the region at the diff base, the branch
# has undone the direct edit and the change now lives in the fragment.
# A fence toggles on its OWN marker, and the open marker is what the walk remembers: a ~~~ line
# inside a ``` block (and a ``` line inside a ~~~ block) is content, not a closer. This is the
# same rule as `fenceMarker` in changelog-fragments.mjs (issue #698), so the direct-edit rule and
# the release fold cannot disagree about which lines sit inside a code block.
unreleased_region() {
  awk '
    BEGIN { fence = ""; grab = 0 }
    {
      marker = ($0 ~ /^`{3,}/) ? "`" : ($0 ~ /^~{3,}/ ? "~" : "")
      if (marker != "" && (fence == "" || fence == marker)) {
        if (grab) print
        fence = (fence == "") ? marker : ""
        next
      }
      if (fence != "") { if (grab) print; next }
      if ($0 ~ /^# Unreleased[[:space:]]*$/) { grab = 1; print; next }
      if (grab && $0 ~ /^# /) grab = 0
      if (grab) print
    }
  '
}

if [ -n "$diff_base" ]; then
  file_dir="$(cd "$(dirname "$file")" && pwd -P)" || exit 2
  repo_root="$(git -C "$file_dir" rev-parse --show-toplevel 2>/dev/null || printf '')"
  if [ -z "$repo_root" ]; then
    printf 'changelog-check: --diff-base needs %s to sit inside a git repository\n' "$file" >&2
    exit 2
  fi
  rel="$(git -C "$file_dir" rev-parse --show-prefix)$(basename "$file")"
  base_sha=""
  if [ "$diff_base" = "auto" ]; then
    for candidate in "${GATE_BASE_SHA:-}" "origin/main" "main"; do
      [ -n "$candidate" ] || continue
      git -C "$repo_root" rev-parse --verify --quiet "$candidate^{commit}" >/dev/null 2>&1 || continue
      base_sha="$(git -C "$repo_root" merge-base HEAD "$candidate" 2>/dev/null || printf '')"
      [ -n "$base_sha" ] && break
    done
  else
    base_sha="$(git -C "$repo_root" rev-parse --verify --quiet "$diff_base^{commit}" 2>/dev/null || printf '')"
    if [ -z "$base_sha" ]; then
      printf 'changelog-check: --diff-base "%s" does not resolve to a commit\n' "$diff_base" >&2
      exit 2
    fi
    base_sha="$(git -C "$repo_root" merge-base HEAD "$base_sha" 2>/dev/null || printf '%s' "$base_sha")"
  fi
  if [ -z "$base_sha" ]; then
    # NOT a pass and NOT a refusal: the input the rule reads is absent. The caller that always
    # has a base (the gate run) never reaches this; a bare checkout does, and says so.
    printf 'changelog-check: no diff base resolved for --diff-base auto; the direct-edit rule was NOT checked\n' >&2
  else
    old="$(mktemp "${TMPDIR:-/tmp}/changelog-base.XXXXXX")"
    new="$(mktemp "${TMPDIR:-/tmp}/changelog-new.XXXXXX")"
    refused=0
    edited_by=""
    commits="$(git -C "$repo_root" log --first-parent --no-merges --format=%H "$base_sha"..HEAD -- "$rel" 2>/dev/null || printf '')"
    while IFS= read -r sha; do
      [ -n "$sha" ] || continue
      git -C "$repo_root" show "$sha^:$rel" > "$old" 2>/dev/null || continue
      git -C "$repo_root" show "$sha:$rel" > "$new" 2>/dev/null || continue
      old_region="$(unreleased_region < "$old")"
      new_region="$(unreleased_region < "$new")"
      if [ -n "$new_region" ] && [ "$old_region" != "$new_region" ]; then
        edited_by="$sha"
        break
      fi
    done <<EOF
$commits
EOF
    # ...and only when that edit is still the state at HEAD. A branch that reverted its direct
    # edit and moved the bullet into a fragment has repaired itself; refusing it would leave the
    # branch red for good and spend its repair budget on a change it already made correctly.
    if [ -n "$edited_by" ]; then
      base_region=""
      head_region=""
      git -C "$repo_root" show "$base_sha:$rel" > "$old" 2>/dev/null && base_region="$(unreleased_region < "$old")"
      git -C "$repo_root" show "HEAD:$rel" > "$new" 2>/dev/null && head_region="$(unreleased_region < "$new")"
      if [ "$base_region" != "$head_region" ]; then
        say "the '# Unreleased' section of $file was edited directly by $(git -C "$repo_root" rev-parse --short "$edited_by") and still differs from the diff base at HEAD; write changelog.d/<pr-or-branch>.md instead and let the release fold it in"
        refused=1
      fi
    fi
    # An uncommitted edit is the same act; readiness refuses a dirty tree, so this is the belt
    # to that suspenders, not the ordinary path.
    if [ "$refused" -eq 0 ]; then
      if git -C "$repo_root" show "HEAD:$rel" > "$old" 2>/dev/null && ! cmp -s "$old" "$file"; then
        old_region="$(unreleased_region < "$old")"
        new_region="$(unreleased_region < "$file")"
        if [ -n "$new_region" ] && [ "$old_region" != "$new_region" ]; then
          say "the '# Unreleased' section of $file has an uncommitted edit; write changelog.d/<pr-or-branch>.md instead and let the release fold it in"
        fi
      fi
    fi
    if [ "$refused" -eq 0 ] && [ "$fail" -eq 0 ]; then
      if [ -n "$edited_by" ]; then
        printf 'changelog-check: diff base %s — the direct edit of %s was reverted; the section at HEAD matches the base\n' "${base_sha:0:12}" "$rel"
      else
        printf 'changelog-check: diff base %s — no direct edit of %s\n' "${base_sha:0:12}" "$rel"
      fi
    fi
    rm -f "$old" "$new"
  fi
fi

# --- Changelog fragments (issue #668) -----------------------------------------------------------
# One small file per pull request under changelog.d/. The grammar lives in one module so the check
# and the release fold cannot disagree about what a fragment is.
if [ -n "$fragments" ]; then
  if ! node "$SCRIPT_DIR/changelog-fragments.mjs" --check "$fragments"; then
    fail=1
  fi
fi

# Walk the top-level headings in file order, ignoring fenced code blocks. Every dated release
# heading raises `seen_dated`; an Unreleased heading after that point is out of order.
# The fence rule is the one in changelog-fragments.mjs `fenceMarker` (issue #698): a line opening
# with three or more backticks or tildes toggles the fence only when no fence is open or the open
# fence carries the SAME marker, so a ``` line inside a ~~~ block stays content.
unreleased=0
fence=""
seen_dated=0
misplaced=0
version_count=0
while IFS= read -r line || [ -n "$line" ]; do
  marker=""
  case "$line" in
    '```'*) marker='`' ;;
    '~~~'*) marker='~' ;;
  esac
  if [ -n "$marker" ] && { [ -z "$fence" ] || [ "$fence" = "$marker" ]; }; then
    if [ -z "$fence" ]; then fence="$marker"; else fence=""; fi
    continue
  fi
  [ -z "$fence" ] || continue
  case "$line" in
    '# '*) ;;
    *) continue ;;
  esac
  if printf '%s' "$line" | grep -Eq '^# Unreleased[[:space:]]*$'; then
    unreleased=$((unreleased + 1))
    [ "$seen_dated" -eq 0 ] || misplaced=1
    continue
  fi
  if printf '%s' "$line" | grep -Eq '^# [0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)? \('; then
    seen_dated=1
    if [ -n "$require" ] && printf '%s' "$line" | grep -Fq "# $require ("; then
      version_count=$((version_count + 1))
    fi
  fi
done < "$file"

[ "$unreleased" -le 1 ] || say "$file has $unreleased '# Unreleased' headings; fold them into one section"
[ "$misplaced" -eq 0 ] || say "$file has an '# Unreleased' heading below a dated release heading; Unreleased must be the first section"
if [ -n "$require" ]; then
  [ "$unreleased" -eq 0 ] || say "$file still has an '# Unreleased' heading; version $require must absorb it"
  [ "$version_count" -eq 1 ] || say "$file has $version_count '# $require (' headings; expected exactly one"
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
if [ -n "$require" ]; then
  printf 'changelog-check: OK — one "# %s (" heading, no "# Unreleased"\n' "$require"
else
  printf 'changelog-check: OK — %d "# Unreleased" heading(s), in order\n' "$unreleased"
fi
