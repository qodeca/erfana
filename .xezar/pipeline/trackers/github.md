# Tracker provider: GitHub

This file is the GitHub implementation of the tracker operations contract (see `TEMPLATE.md` for the contract itself). Skills perform issue/PR state management through **named tracker operations** — `**get-issue**`, `**comment-pr**`, and so on — and this file defines what each operation means for GitHub, using the `gh` CLI.

At runtime: `xez-setup-agent-pipeline` copies this file into the repository at `.xezar/pipeline/trackers/github.md`, and the config's `tracker` field selects it. When a skill says "tracker operation **get-pr**", execute the command documented under that operation heading in the repo's copy. The repo's copy is authoritative: teams extend or override any operation by editing it, and every skill picks the change up on its next run. An operation not covered by an edit keeps its behavior from this file's text as copied.

## Prerequisites

- `gh` CLI installed and authenticated, and `jq` available (the label guards and several operations parse JSON with it). Verify with the **auth-check** operation before a batch run; fail fast when unauthenticated.
- **Minimum `gh` version: 2.82.1** (released 2025-10-22). Older clients abort every label, assignee, and title/body edit on the retired Projects (classic) API — see the next section. **auth-check** warns when the installed client is older.
- All operations accept an optional `{repo}` (`owner/name`); when omitted, `gh` infers it from the current checkout's git remote. Pass `--repo {owner}/{repo}` explicitly whenever a skill operates on a repository other than the current one.

### Projects (classic) deprecation — the failure that silently leaves a PR unlabeled

GitHub [sunset Projects (classic)](https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/), and its GraphQL fields (`repository.pullRequest.projectCards`, `repository.issue.projectCards`, `organization.projects`) now answer with an error instead of data. `gh pr edit` and `gh issue edit` reach the API through GraphQL and, on clients older than 2.82.1, request those retired fields **unconditionally** — no `--add-project` flag involved. `gh` treats the error as fatal, so the command exits non-zero **before applying the edit**, printing only:

```text
GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. (repository.pullRequest.projectCards)
```

That text reads like a deprecation warning, but the label was never applied and the PR keeps its previous state.

**Diagnose it correctly.** Any operation failing with `Projects (classic) is being deprecated` is reporting a **stale `gh` client**, not a repository or organization misconfiguration: no classic project has to be attached to anything for it to fire, and it is not specific to one repo, one owner, or one token.

**Why this descriptor does not hit it.** Every label, assignee, and title/body mutation below is written against the REST API (`gh api`), which never touches the GraphQL project fields and therefore behaves identically on every client version. That is deliberate — do not "simplify" the guards back to `gh pr edit --add-label`.

**Upgrade the client anyway.** Read paths keep the coupling: `gh issue view` / `gh pr view` without `--json` render the classic project column, and `projectCards` is still offered as a fetchable `--json` field (cli/cli#11769), so a field list that names it errors on any version. Distribution packages lag years behind — Debian bookworm ships 2.23, Ubuntu 2.45, Alpine stable 2.72, all affected — so install from [GitHub's own package repositories](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#recommended-official) or Homebrew rather than the distro's:

```bash
gh --version                                   # must report >= 2.82.1
brew upgrade gh                                # macOS / Linuxbrew
sudo apt update && sudo apt install --only-upgrade gh   # after adding GitHub's apt repo
```

Upstream references: cli/cli#11983 (`gh pr edit` aborts without any project flag), cli/cli#11986 → fixed in [v2.82.1](https://github.com/cli/cli/releases/tag/v2.82.1) ("Fix `gh pr edit` not detecting classic projects feature deprecation"), cli/cli#11992 / #12476 / #12640 (the same error from `gh issue view`; the maintainers' answer is to upgrade), cli/cli#11769 (open: drop `projectCards` as a fetchable field).

## Conventions

- Issue and PR identifiers are numbers; in text they are written `#123`.
- A `--json` field list must never include `projectCards`: it is a Projects (classic) relic that errors on every client version (see above). Request only the fields the calling skill names.
- A PR is linked to the issue it resolves with `Fixes #{issueId}` (or `Closes #{issueId}`) in the PR body; GitHub then closes the issue on merge. To reference without auto-closing, use a plain issue link.
- PRs open as **drafts** when a skill says so; a human (or **mark-pr-ready**) promotes them.
- Claim/lock signals on an issue or PR are: assignee set to the automation user, the local active-ownership label, and a `🤖`-prefixed claim comment. All three are set on claim; the label is guarded (below). The the local CI-observation label label is **not** a claim signal — it marks work that is finished and reported while its CI-result follow-up is still owed, and never makes another skill back off.
- Long, multi-line comment bodies are posted with `--body-file` (or a heredoc via process substitution) so formatting is preserved.
- CI status truth comes from **get-pr-checks**; the set of *required* checks comes from **get-required-checks** (branch protection). When branch protection is not readable (404), treat every reported check as required.

## Label guards

Every label mutation goes through an existence guard so a missing label degrades to a logged skip instead of a failure, and `labels.enabled: false` in the config skips label operations entirely.

The guards mutate through the **REST API**, not `gh pr edit` / `gh issue edit`. Those two route through GraphQL, which requests the retired Projects (classic) fields on clients older than 2.82.1 and aborts the whole edit before the label lands (see Prerequisites). REST never touches those fields, so labels apply on any client version. Keep it that way.

```bash
# Target repository: $REPO when a skill addresses another repository (set by repo-info),
# otherwise the current checkout's.
tracker_repo() {
  if [ -n "${REPO:-}" ]; then printf '%s' "$REPO"
  else gh repo view --json nameWithOwner --jq .nameWithOwner; fi
}

label_exists() {
  gh api --paginate "repos/$(tracker_repo)/labels" --jq '.[].name' | grep -Fxq "$1"
}

# PR labels. $1 = label, $2 = PR number.
apply_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh api -X POST "repos/$(tracker_repo)/issues/$2/labels" -f "labels[]=$1" >/dev/null
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

# Issue labels. GitHub labels issues and PRs through the same /issues/ endpoint, so this
# delegates; it keeps its own name because skills call the guards by name. $1 = label,
# $2 = issue id.
apply_issue_label() { apply_label "$1" "$2"; }

# Removal. $1 = label, $2 = PR or issue number. A label that is not currently applied
# answers 404 — a no-op, not a failure, so removal needs no existence check.
remove_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  gh api -X DELETE \
    "repos/$(tracker_repo)/issues/$2/labels/$(printf '%s' "$1" | jq -sRr @uri)" \
    >/dev/null 2>&1 || true
}
remove_issue_label() { remove_label "$1" "$2"; }

# Pipeline labels are mutually exclusive: setting one removes the others first.
# Note the argument order, unchanged: $1 = PR number, $2 = label.
set_pipeline_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  for label in $PIPELINE_LABELS; do
    [ "$label" = "$2" ] && continue
    remove_label "$label" "$1"
  done
  apply_label "$2" "$1"
}
```

Cross-repository targets need no extra flags: `tracker_repo` resolves `$REPO` when a skill set it, and every guard interpolates the result, so the existence check and the mutation always address the same repository.

Read the labels back (`gh pr view {prNumber} --json labels`) whenever the label state gates a later decision — a mutation the guard logged as skipped is a normal outcome, and a run that assumes it landed will branch wrongly.

## Operations

### Identity and repository

#### auth-check
Verify the CLI is authenticated and new enough. → exit status (non-zero when unauthenticated), plus a warning on stdout when the client predates the Projects (classic) fix.
```bash
gh auth status || exit 1

# Clients older than 2.82.1 abort `gh pr edit` / `gh issue edit` on the retired Projects
# (classic) GraphQL fields (see Prerequisites). The guards mutate through REST, so a run
# still works — but read paths stay affected, so warn instead of failing silently.
GH_VERSION=$(gh --version | sed -n '1s/.*gh version \([0-9][0-9.]*\).*/\1/p')
MIN_GH_VERSION=2.82.1
if [ "$(printf '%s\n%s\n' "$MIN_GH_VERSION" "$GH_VERSION" | sort -V | head -n1)" != "$MIN_GH_VERSION" ]; then
  echo "WARNING: gh $GH_VERSION predates $MIN_GH_VERSION — 'gh pr edit'/'gh issue edit' fail on the Projects (classic) deprecation. Upgrade: https://github.com/cli/cli/blob/trunk/docs/install_linux.md#recommended-official"
fi
```
`sort -V` exists on GNU and BSD/macOS `sort`; where it does not, compare `gh --version` against 2.82.1 by inspection and report the same warning.

#### current-user
→ the automation user's login.
```bash
CURRENT_USER=$(gh api user --jq '.login')
```

#### repo-info
→ `owner/name` handle and default branch of the current repository.
```bash
gh repo view --json nameWithOwner,defaultBranchRef
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

#### default-branch
→ the repository's default branch name (used when the config's `baseBranch` is `"auto"`).
```bash
BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
```

### Issues

#### get-issue
`{issueId}`, field list → issue data. Request only the fields the calling skill names.
```bash
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

#### search-issues
Query (text, `in:title,body`, state) → matching issues.
```bash
gh issue list --repo {owner}/{repo} --state open --search "<query> in:title,body" --json number,title,url
```

#### create-issue
Title, body, assignee, labels → created issue URL.
```bash
gh issue create --repo {owner}/{repo} --title "<title>" --assignee <login> --label <labels> --body "<body>"
```

#### close-issue
`{issueId}`, reason, closing comment.
```bash
gh issue close {issueId} --repo {owner}/{repo} --reason completed --comment "<comment>"
```

#### comment-issue
`{issueId}`, body (use a heredoc/body-file for multi-line bodies).
```bash
gh issue comment {issueId} --repo {owner}/{repo} --body "<body>"
```

#### update-issue
`{issueId}`, new title and/or body. Edits the issue's own fields; does not touch labels or assignees (those have their own operations). Pass only what changed; read the body from a file so multi-line content survives.
```bash
gh api -X PATCH repos/{owner}/{repo}/issues/{issueId} -f title="<title>"
gh api -X PATCH repos/{owner}/{repo}/issues/{issueId} -F body=@<file>
```
`gh issue edit {issueId} --title "<title>" --body-file <file>` does the same on `gh` >= 2.82.1 and is fine interactively; older clients fail before writing anything (see Prerequisites), so script the REST form.

#### assign-issue / unassign-issue
```bash
gh api -X POST   repos/{owner}/{repo}/issues/{issueId}/assignees -f "assignees[]=<login>"
gh api -X DELETE repos/{owner}/{repo}/issues/{issueId}/assignees -f "assignees[]=<login>"
```

#### label-issue / unlabel-issue
Always through the guards: `apply_issue_label "<label>" {issueId}` / `remove_issue_label "<label>" {issueId}`.

#### get-issue-comment
Comment id → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-issue-comments
`{issueId or prNumber}` → conversation comments (PR conversation comments are issue comments on GitHub).
Paginated: without `--paginate` GitHub returns only the first 30 and the request still succeeds, so a marker on an older comment reads as absent and a marker-idempotent re-run posts a duplicate instead of updating in place.
```bash
gh api --paginate repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {id,user:.user.login,body}'
```

#### update-comment
`{commentId}`, new body → rewrite an existing conversation comment in place (works for issue and PR conversation comments alike). This is how marker-idempotent comments (label rationale, verification, claim take-overs) are updated on re-runs: find your `🤖 …` marker via **list-issue-comments**, then update that comment instead of posting a new one. Use a body file so multi-line bodies survive.
```bash
gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@<path>
```

### Pull requests

#### get-pr
`{prNumber}`, field list → PR data. Request only the fields the calling skill names; the full field set skills use:

Normalized fields (TEMPLATE contract): `headRefOid` and `baseRefOid` come back directly.
`reviewVerdict` is derived from `reviewDecision`, because GitHub's field is empty both when no
review has happened and when no review is required — and a merge gate must not read the second
as the first:

| `reviewDecision` | `reviewVerdict` |
|---|---|
| `APPROVED` | `approved` |
| `CHANGES_REQUESTED` | `rejected` |
| `REVIEW_REQUIRED` | `pending` |
| empty, and branch protection requires reviews | `pending` |
| empty, and branch protection does not require reviews (or is unreadable) | `not-enforced` |

Read the requirement from **get-required-checks**' protection call; when that returns 404 the
review requirement is unreadable, so the verdict is `not-enforced` and the gate refuses rather
than reading silence as approval.
```bash
gh pr view {prNumber} --json number,title,url,body,state,author,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files,assignees,comments,mergedAt,mergeCommit,closingIssuesReferences,createdAt,closedAt,additions,changedFiles
```

#### list-prs
State/search filters, field list, limit → PRs.
```bash
gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft,assignees --limit 100
gh pr list --state merged --search "merged:>=${SINCE_DATE}" --json number,title,url,body,author,createdAt,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
gh pr list --state closed --search "closed:>=${SINCE_DATE} is:unmerged" --json number,createdAt,title,url,body,author,closedAt,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
```

#### search-prs
Free-text query (for example an issue reference) and state → matching PRs.
```bash
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
```

#### create-pr
Base branch, draft flag, title, body → PR.
```bash
gh pr create --repo {owner}/{repo} --base "$BASE_BRANCH" --draft --title "<title>" --body "<body>"
PR_URL=$(gh pr view --json url --jq .url)
PR_NUMBER=$(gh pr view --json number --jq .number)
```

#### update-pr
`{prNumber}`, new title and/or new body → the PR's own title/body rewritten in place (not a comment), e.g. describing what a PR actually ships once its scope changed. Pass whichever of title / body changed; omit the other. Read the body from a file so multi-line content survives.
```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -f title="<title>"
gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -F body=@<path>
```
`gh pr edit {prNumber} --title … --body-file …` does the same on `gh` >= 2.82.1. On older clients it exits non-zero with the Projects (classic) error and writes nothing (see Prerequisites) — which reads like a no-op, so script the REST form above.

#### comment-pr
`{prNumber}`, body. For long structured comments:
```bash
gh pr comment {prNumber} --body-file <path-or-process-substitution>
```

#### attach-image-evidence
`{prNumber}`, a markdown comment body (without the images), a `{slug}` (e.g. `pr-{prNumber}`), and a list of local PNG paths → post one comment with the images embedded **inline**, and return the comment URL.

GitHub does not accept image bytes through the comment API, so make the images referenceable first. For a **public** repo, upload them to a dedicated **slash-free** evidence branch (never the change's own branch) via the Contents API and reference `raw.githubusercontent.com` URLs — those render inline in comments:

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
EVIDENCE_BRANCH="qa-evidence-{slug}"                 # slash-free: some raw URLs 404 on slashed refs
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)

# create the evidence branch if missing (branched from the default branch head)
gh api "repos/${OWNER_REPO}/git/refs/heads/${EVIDENCE_BRANCH}" >/dev/null 2>&1 || {
  SHA=$(gh api "repos/${OWNER_REPO}/git/refs/heads/${DEFAULT_BRANCH}" --jq .object.sha)
  gh api -X POST "repos/${OWNER_REPO}/git/refs" -f ref="refs/heads/${EVIDENCE_BRANCH}" -f sha="$SHA" >/dev/null
}

# upload each image. An image-sized base64 string blows the shell arg limit, so it
# must never touch a command line — write it to a temp file and let `jq --rawfile`
# read it into the JSON body, which `gh api --input -` sends over stdin. Pass the
# existing blob sha to overwrite on re-runs.
BODY_IMAGES=""
for img in <image-paths>; do
  path="{slug}/$(basename "$img")"
  base64 < "$img" | tr -d '\n' > /tmp/ev-content.b64            # portable across GNU/BSD; no newlines
  existing=$(gh api "repos/${OWNER_REPO}/contents/${path}?ref=${EVIDENCE_BRANCH}" --jq .sha 2>/dev/null || true)
  jq -n --rawfile c /tmp/ev-content.b64 --arg m "qa evidence {slug}" --arg b "$EVIDENCE_BRANCH" --arg s "$existing" \
     'if $s == "" then {message:$m,branch:$b,content:$c} else {message:$m,branch:$b,content:$c,sha:$s} end' \
     | gh api -X PUT "repos/${OWNER_REPO}/contents/${path}" --input - >/dev/null
  url="https://raw.githubusercontent.com/${OWNER_REPO}/${EVIDENCE_BRANCH}/${path}"
  BODY_IMAGES="${BODY_IMAGES}\n![$(basename "$img")](${url})"
done

# assemble the comment (caller's body + the image markdown) and post it
{ cat <body-file>; printf "%b" "$BODY_IMAGES"; } | gh pr comment {prNumber} --body-file -
gh pr view {prNumber} --json url --jq .url
```

Fallbacks: for a **private** repo the raw URLs need auth and will not render — post the comment with the image links plus the local artifact paths and note that inline rendering is unavailable (a private-visibility limit), rather than failing. When even the evidence branch cannot be pushed (no write access), degrade to listing the artifact paths in the comment. Never store evidence on the change's own branch, and never force-push.

#### assign-pr / unassign-pr
Assignees live on the shared `/issues/` endpoint for PRs too — `{prNumber}` is the path segment.
```bash
gh api -X POST   repos/{owner}/{repo}/issues/{prNumber}/assignees -f "assignees[]=<login>"
gh api -X DELETE repos/{owner}/{repo}/issues/{prNumber}/assignees -f "assignees[]=<login>"
```

#### label-pr / unlabel-pr
Always through the guards: `apply_label "<label>" {prNumber}` / `set_pipeline_label {prNumber} "<label>"` for the mutually exclusive pipeline group; direct removal: `remove_label "<label>" {prNumber}`.

#### get-pr-diff
`{prNumber}` → full diff, or the changed-file list with `--name-only`.
```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

#### get-pr-files
`{prNumber}` → changed files with per-file status (added/modified/removed), paginated.
```bash
gh api "repos/{owner}/{repo}/pulls/{prNumber}/files" --paginate --jq '.[] | {path: .filename, status: .status}'
```

#### checkout-pr
`{prNumber}` → the PR's head available locally (needed for cross-repository fork PRs where the head branch cannot be fetched from `origin`).
```bash
gh pr checkout {prNumber} --recurse-submodules=no
```

#### review-pr
`{prNumber}`, verdict (approve / request changes), body.
```bash
gh pr review {prNumber} --approve --body "<body>"
gh pr review {prNumber} --request-changes --body "<body>"
```
GitHub rejects self-approval (reviewing your own PR); surface that instead of working around it.

#### merge-pr
`{prNumber}`; squash is the default merge strategy. `--auto` merges when checks pass; `--delete-branch` only when asked.
`{headSha}` pins the merge to one commit: the merge is rejected (exit non-zero) when the PR head has moved since the caller checked its gates. Always pass it when the caller has a head commit; omit it only when the caller has none.
```bash
gh pr merge {prNumber} --squash --match-head-commit {headSha}
```

#### mark-pr-ready
Promote a draft PR.
```bash
gh pr ready {prNumber}
```

#### get-pr-checks
`{prNumber}` → CI check runs with name, state, and link.
```bash
gh pr checks {prNumber} --json name,state,link
```

#### get-required-checks
Base branch → the set of required status checks. A 404 means branch protection is not readable — treat all reported checks as required.
```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

#### branch-protected
Branch + required checks → that branch ends the call protected. Needs admin on the repository.

`enforce_admins` is passed by the caller and is **not** defaulted here. A setup whose leader
writes its own record files straight to the base branch needs it `false`; a repository where
nobody may bypass needs it `true`. Guessing either way is wrong for half the callers.

```bash
CONTEXTS=$(printf '%s\n' "$@" | jq -R . | jq -sc .)   # required check names, as given
jq -nc --argjson c "$CONTEXTS" --argjson admins "${ENFORCE_ADMINS:-false}" '{
  required_status_checks: { strict: true, contexts: $c },
  enforce_admins: $admins,
  required_pull_request_reviews: null,
  restrictions: null
}' | gh api -X PUT "repos/{owner}/{repo}/branches/{branch}/protection" --input - >/dev/null
```

`403` or `404` means no admin rights on this repository: **do not** report the branch as
protected. Print the command above for someone who has them, and return `unknown`. Then
re-read with **get-required-checks** either way — a write that returned success and a branch
that is actually protected are different claims, and only the second is worth reporting.

#### get-pr-comment / get-review-comment
Conversation comment id (`issuecomment-<id>` links) vs inline review comment id (`discussion_r<id>` links) → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
gh api repos/{owner}/{repo}/pulls/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-review-comments
`{prNumber}` → every inline review comment on the diff (the conversation comments come from **list-issue-comments**; these are the ones anchored to a file and line).
```bash
gh api --paginate repos/{owner}/{repo}/pulls/{prNumber}/comments \
  --jq '.[] | {id,user:.user.login,path,line:(.line // .original_line),body,url:.html_url,reply_to:.in_reply_to_id}'
```
REST does not expose a thread's resolved state (that lives in GraphQL's review threads), so treat every returned comment as potentially open and judge it against the current diff. `reply_to` is non-null on replies, which is what lets you reconstruct a thread. Consumers treat an unavailable operation as "inline feedback out of reach", not as a failure: they fall back to review bodies plus conversation comments and state the gap in their report.

#### get-pr-template
→ the repository's pull-request template, or nothing. GitHub looks in several places; check them
in order and stop at the first hit.
```bash
for p in .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md \
         docs/pull_request_template.md pull_request_template.md; do
  [ -f "$p" ] && { cat "$p"; break; }
done
```
Nothing found is `not-applicable`: the repository has no template, which is not a failure.

#### get-issue-templates
→ the repository's issue templates. Modern repositories use YAML forms under
`.github/ISSUE_TEMPLATE/`; older ones use Markdown files in the same directory.
```bash
for f in .github/ISSUE_TEMPLATE/*.yml .github/ISSUE_TEMPLATE/*.yaml; do
  [ -f "$f" ] || continue
  printf 'TEMPLATE_ID=%s\n' "$(basename "$f")"
  printf 'TEMPLATE_NAME=%s\n' "$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n 1)"
done
for f in .github/ISSUE_TEMPLATE/*.md; do
  [ -f "$f" ] || continue
  printf 'TEMPLATE_ID=%s\n' "$(basename "$f")"
  printf 'TEMPLATE_NAME=%s\n' "$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n 1)"
done
```
Parse a YAML form's `body:` entries for the field list: each entry's `id`, its `attributes.label`,
and `validations.required`. A required field with no answer is a question for the user, never a
guess — an invented answer in a required field is indistinguishable from a real one.

Both operations read the checkout, so on a gate path read them from the base branch ref.


### Verification records

A verification record is what a gate run leaves behind so a human, and a later run, can read
what happened. It is a **published record, not an authority**: anyone who can comment on a pull
request can write text that looks like one, so a gate never satisfies itself from a record and
always re-derives from the authenticated API at the head commit. Read it for reporting and
caching only, and never echo a record body into a report — report the parsed fields.

The body is a fenced `text` block of `NAME=value` lines, **split on the first `=` only** and
**never sourced as shell**; a value may contain anything, including `$(...)`. Unknown names are
ignored so the grammar can grow. `Gate=` / `Status=` repeat as a pair, in order, once per gate.

```text
Head=<head commit sha>
Base=<base commit sha, or unknown>
Skill=<skill name>
At=<ISO-8601 timestamp>
Gate=<gate name>
Status=<pass|findings|unknown|not-applicable|evidence-unavailable>
Verdict=<allowed|refused>
```

A record whose `Head=` is not the commit a later run is deciding about describes a different
commit, and is ignored rather than disputed.

On a merge-gate path these two operations run from the **base branch's** copy of this
descriptor, fetched with `git fetch --depth=1` and read with `git show`. The working tree is the
pull request under review, so a request that edited this file would otherwise write its own
record and define its own reading of it.

#### put-verification-record
`{prNumber}`, `{skillName}`, a record body file → post or update one marker-idempotent comment
and return its URL. Find this skill's own record first; rewrite it in place rather than posting
a second one.
```bash
MARKER="🤖 \`{skillName}\` — verification record"
EXISTING=$(gh api --paginate repos/{owner}/{repo}/issues/{prNumber}/comments \
  --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | tail -n 1)
{
  printf '%s\n\n' "$MARKER"
  printf '```text\n'
  cat <path>
  printf '```\n'
} > "$BODY_FILE"
if [ -n "$EXISTING" ]; then
  gh api -X PATCH repos/{owner}/{repo}/issues/comments/"$EXISTING" -F body=@"$BODY_FILE" --jq .html_url
else
  gh api -X POST repos/{owner}/{repo}/issues/{prNumber}/comments -F body=@"$BODY_FILE" --jq .html_url
fi
```
The marker match also accepts the legacy bare `🤖 {skillName} — verification record` form, so a
re-run never duplicates a record written by an older skill version.

#### get-verification-record
`{prNumber}`, optionally `{skillName}` → the most recent record body and its URL, or nothing.
```bash
gh api --paginate repos/{owner}/{repo}/issues/{prNumber}/comments \
  --jq '[.[] | select(.body | test("— verification record")) | {body,url:.html_url,at:.created_at}] | last'
```
Nothing returned means no record exists, which is not a failure and never a gate input: report
the record as unavailable and decide from the API as usual.

### CI runs

CI status for a *PR* comes from **get-pr-checks** / **get-required-checks** above. The operations here address CI runs directly — needed when working from a bare branch, or when a failure diagnosis needs the actual logs.

#### list-runs
Branch (or head SHA) → recent workflow runs with id, workflow name, status, and conclusion.
```bash
gh run list --branch {branch} --limit 20 --json databaseId,workflowName,name,status,conclusion,headSha,url,createdAt
```

#### get-run
Run id → status, conclusion, and per-job breakdown.
```bash
gh run view {runId} --json status,conclusion,workflowName,headSha,url,jobs
```

#### get-run-failed-logs
Run id → the log output of failed steps only. This is the primary diagnosis input for CI failures.
```bash
gh run view {runId} --log-failed
```

#### rerun-failed
Run id → re-execute only the failed jobs of that run. Use to disambiguate flaky failures before changing any code.
```bash
gh run rerun {runId} --failed
```

#### watch-run
Run id → block until the run completes, exiting non-zero on failure. Prefer this over sleep-polling; fall back to periodic **get-run** when watching is unavailable.
```bash
gh run watch {runId} --exit-status
```

### Labels

#### list-labels
→ all label names defined in the repo. Paginated, so repositories with large taxonomies are not truncated the way a fixed `gh label list --limit` is.
```bash
gh api --paginate repos/{owner}/{repo}/labels --jq '.[].name'
```

#### create-label
Name, color, description. Never delete, rename, or recolor existing labels.
```bash
gh label create <name> --color <hex> --description "<description>"
```

#### ensure-label-taxonomy
Resolve the exact label names, colors and descriptions from the authorized local taxonomy and **list-labels** evidence. The taxonomy is data when the pipeline ships it: `.xezar/pipeline/labels.json` carries a colour per group and a description per label, so two repositories installing the same pipeline get the same labels meaning the same things. When that file is absent, fall back to the label names in `.xezar/pipeline/config.json` and ask for colours and descriptions rather than inventing them. Create only the approved missing entries through **create-label** above; skip existing names without recoloring them. Never seed a universal list from this descriptor. When no taxonomy is established or creation is not authorized, report that and perform no label writes.
