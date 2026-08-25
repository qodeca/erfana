# GitHub issues protocol for Claude Code

This document defines when and how Claude Code should interact with GitHub Issues in the Erfana project.

## Core principle

**All GitHub Issues activities MUST be initialized by the user.** Claude Code must never proactively create, modify, or close issues without explicit user instruction.

## Permission levels

### Autonomous (no approval required)

These read-only operations can be performed freely for context gathering:

```bash
# List issues for context
gh issue list
gh issue list --state all --limit 20
gh issue list --label "bug" --json number,title,state

# View specific issue details
gh issue view <number>
gh issue view <number> --json title,body,labels,assignees,milestone

# Search issues
gh search issues "<query>" --repo qodeca/erfana

# List labels
gh label list
```

**Use cases:**
- Understanding current project priorities
- Checking if a bug is already reported
- Finding related issues before starting work
- Gathering context for PR descriptions

### Requires user instruction

These operations modify GitHub state and require explicit user request:

| Operation | Command | When to suggest |
|-----------|---------|-----------------|
| Create issue | `gh issue create` | After finding a bug or identifying a feature need |
| Edit issue | `gh issue edit <n>` | When issue details need updating |
| Close issue | `gh issue close <n>` | After PR merge or confirmed resolution |
| Reopen issue | `gh issue reopen <n>` | When issue recurs or was closed prematurely |
| Comment | `gh issue comment <n>` | To add implementation notes or questions |
| Add labels | `gh issue edit <n> --add-label` | When categorization changes |
| Assign | `gh issue edit <n> --add-assignee` | When ownership is determined |
| Pin/Unpin | `gh issue pin/unpin <n>` | For important announcements |
| Transfer | `gh issue transfer <n>` | Moving to different repository |
| Delete | `gh issue delete <n>` | Rarely - permanent removal |

## Workflow patterns

### Pattern 1: bug discovery during development

When Claude Code discovers a bug while working on another task:

1. **DO**: Mention the bug to the user with details
2. **DO**: Suggest creating an issue with proposed title/body
3. **DO NOT**: Create the issue automatically
4. **WAIT**: For user to say "create the issue" or similar

Example interaction:
```
Claude: I found a potential bug: the file watcher doesn't handle symlinks
        correctly. Should I create an issue for this?

        Suggested:
        - Title: "File watcher fails to detect changes in symlinked directories"
        - Labels: bug

User:   Yes, create it.

Claude: [Now creates the issue with gh issue create]
```

### Pattern 2: feature request identification

When discussing potential features:

1. **DO**: Document the feature requirements in conversation
2. **DO**: Offer to create an issue when discussion concludes
3. **DO NOT**: Create issues for every idea discussed
4. **WAIT**: For explicit confirmation

### Pattern 3: linking issues to work

When working on a task related to an existing issue:

1. **DO**: Reference issue numbers in commit messages (`Fixes #123`)
2. **DO**: Include `Closes #123` in PR descriptions when appropriate
3. **DO**: Check issue for acceptance criteria before starting
4. **DO NOT**: Close issues manually - let PR merge handle it

### Pattern 4: issue triage assistance

When user asks for help organizing issues:

1. **DO**: List and categorize existing issues
2. **DO**: Suggest label changes or priorities
3. **DO NOT**: Apply changes without approval
4. **WAIT**: For user to approve each change or batch

## Available labels

All 15 labels below exist on `qodeca/erfana` (read live with `gh label list --repo qodeca/erfana` on 2026-08-23). Do not create new ones without user approval — and check this list before assuming a label is missing.

| Label | Color | Purpose |
|-------|-------|---------|
| `bug` | #d73a4a | Something isn't working |
| `enhancement` | #a2eeef | New feature or request |
| `documentation` | #0075ca | Documentation improvements |
| `duplicate` | #cfd3d7 | Already exists |
| `good first issue` | #7057ff | Good for newcomers |
| `help wanted` | #008672 | Extra attention needed |
| `invalid` | #e4e669 | Doesn't seem right |
| `question` | #d876e3 | Further information requested |
| `wontfix` | #ffffff | Will not be worked on |
| `dependencies` | #0366d6 | Dependency updates (applied by Dependabot) |
| `github_actions` | #000000 | GitHub Actions updates (applied by Dependabot) |
| `javascript` | #168700 | JavaScript code changes (applied by Dependabot) |
| `graph-engine` | #5319e7 | Graph engine (spec 004 / R1) work |
| `canary` | #fbca04 | Scheduled canary-run failures; applied by `whisper-binaries-canary.yml` notify-on-failure |
| `windows` | #1d76db | Windows platform enablement; session-start filter named in `docs/windows/README.md` |

`gh label list` is the authority — this table is a snapshot and can go stale.

## Issue templates

The repo ships **GitHub issue forms**, not free-form markdown bodies, and
[`.github/ISSUE_TEMPLATE/config.yml`](../../.github/ISSUE_TEMPLATE/config.yml) sets
`blank_issues_enabled: false` — every issue opened through the web UI must go through a
form. Fill the form's fields; do not invent your own heading structure.

| Form | File | Auto title prefix | Auto label |
|---|---|---|---|
| Bug report | [`bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml) | `[Bug]: ` | `bug` |
| Feature request | [`feature_request.yml`](../../.github/ISSUE_TEMPLATE/feature_request.yml) | `[Feature]: ` | `enhancement` |

`config.yml` also routes three cases away from the issue tracker entirely: security
vulnerabilities go to [private advisory reporting](https://github.com/qodeca/erfana/security/advisories/new),
never a public issue; questions and open-ended ideas go to Discussions.

### Bug report — fields

| Field | Type | Required |
|---|---|---|
| What happened? | textarea — description plus what you expected | **yes** |
| Steps to reproduce | textarea — minimal ordered steps | **yes** |
| Erfana version | input — from Help → About | **yes** |
| Operating system | dropdown — `macOS` or `Windows` | **yes** |
| Logs or screenshots | textarea — redact anything sensitive | no |

### Feature request — fields

| Field | Type | Required |
|---|---|---|
| Problem or use case | textarea — what you are trying to do and where Erfana falls short | **yes** |
| Proposed solution | textarea — the feature or change you want | **yes** |
| Alternatives considered | textarea — workarounds or other approaches | no |

### Creating an issue from the CLI

`gh issue create` does **not** apply issue forms, so the title prefix and label the form
would have added must be supplied by hand, and every required field must be present as a
heading in the body:

```bash
gh issue create \
  --title "[Bug]: file watcher misses changes in symlinked directories" \
  --label bug \
  --body "## What happened?
…

## Steps to reproduce
1. …

## Erfana version
0.17.2

## Operating system
macOS

## Logs or screenshots
…"
```

An issue that skips a required field is missing information a maintainer will have to ask
for. Match the form.

## Integration with project workflow

### Before starting work
```bash
# Check for related issues
gh issue list --search "<feature-name>"
gh issue view <number>  # Read acceptance criteria
```

### During development
```bash
# Reference in commits
git commit -m "Add feature X

Implements the core functionality for #123"
```

### Creating pull requests
```bash
# Link to issue in PR body
gh pr create --title "Add feature X" --body "Closes #123

## Changes
- Added X
- Updated Y"
```

### After PR merge
- Issues with `Closes #123` syntax auto-close
- If manual close needed, ask user first

**Remember**: GitHub Issues are the user's task management system. Claude Code assists but does not control.
