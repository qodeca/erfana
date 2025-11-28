# Agent: summarize-diff

Generate commit messages and PR descriptions from git changes.

---

## Purpose

Analyze git changes and create conventional commit messages following project standards.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| issue_summary | string | Yes | Brief description of the issue |
| commit_type | string | No | Type hint: feat/fix/docs/refactor/test/chore |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] issue_summary is non-empty string

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Check Git Status

```
Bash(command="git status --porcelain")
```

Verify there are changes to commit.

### Step 2: Get Staged Changes

```
Bash(command="git diff --staged --stat")
Bash(command="git diff --staged")
```

Analyze:
- Files added/modified/deleted
- Lines changed
- Nature of changes

### Step 3: Review Recent Commits

```
Bash(command="git log --oneline -5")
```

Note:
- Commit message style
- Type prefixes used
- Scope patterns

### Step 4: Determine Commit Type

Based on changes:

| Changes | Type |
|---------|------|
| New feature | `feat` |
| Bug fix | `fix` |
| Documentation only | `docs` |
| Code refactoring | `refactor` |
| Tests only | `test` |
| Build/tooling | `chore` |

### Step 5: Determine Scope

Identify affected area:
- `tabs` - Tab components
- `editor` - Editor functionality
- `terminal` - Terminal features
- `tree` - Project tree
- etc.

### Step 6: Write Commit Message

Format:
```
<type>(<scope>): <subject>

<body>

Closes #<issue_number>
```

Rules:
- Subject: imperative mood, <72 chars, no period
- Body: what and why (not how)
- Footer: issue reference

### Step 7: Prepare PR Description (if needed)

Format:
```markdown
## Summary
- Bullet point 1
- Bullet point 2

## Test plan
- [ ] Test scenario 1
- [ ] Test scenario 2
```

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| commit_message | string | Full conventional commit message |
| commit_type | string | Determined commit type |
| commit_scope | string | Determined scope |
| commit_subject | string | Subject line (<72 chars) |
| commit_body | string | Detailed body |
| pr_description | string | PR description if creating PR |

### Output Format

```json
{
  "commit_message": "feat(tabs): add Chrome-style dynamic tabs\n\nImplement EditorTab component...\n\nCloses #11",
  "commit_type": "feat",
  "commit_scope": "tabs",
  "commit_subject": "add Chrome-style dynamic tabs",
  "commit_body": "Implement EditorTab component with dynamic sizing...",
  "pr_description": "## Summary\n- Add dynamic tabs\n\n## Test plan\n- [ ] Verify tabs resize"
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] commit_type is valid conventional type
- [ ] commit_subject is ≤72 characters
- [ ] commit_subject uses imperative mood
- [ ] commit_body explains what and why
- [ ] Issue number referenced in footer

### Subject Line Rules

- Start with lowercase (after type/scope)
- No period at end
- Imperative mood ("add" not "added" or "adds")
- ≤72 characters total

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 300 tokens |
| Maximum | 500 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| No staged changes | Return error, suggest staging |
| Type unclear | Default based on file changes |
| Scope unclear | Use most affected directory |
| Subject too long | Shorten, move details to body |

---

## Commit Type Guide

| Type | Use For |
|------|---------|
| `feat` | New feature for users |
| `fix` | Bug fix for users |
| `docs` | Documentation only |
| `refactor` | Code change without feature/fix |
| `test` | Adding or fixing tests |
| `chore` | Build, tooling, deps |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "issue_summary": "Add Chrome-style dynamic tabs",
  "commit_type": "feat"
}
```

**Execution:**
```
Bash(command="git status --porcelain")
→ M src/.../AppDockLayout.tsx
→ A src/.../EditorTab.tsx
→ A src/.../EditorTab.css

Bash(command="git diff --staged --stat")
→ 3 files changed, 250 insertions

Bash(command="git log --oneline -3")
→ abc1234 fix(terminal): scroll position
```

**Output:**
```json
{
  "commit_message": "feat(tabs): add Chrome-style dynamic tabs with dirty indicator\n\nImplement EditorTab component using DockviewReact headerComponent API.\nTabs resize dynamically between 80-300px.\n\nFeatures:\n- Dirty indicator for unsaved changes\n- Context menu: Close, Close Others, Close All\n- Middle-click to close\n\nCloses #11",
  "commit_type": "feat",
  "commit_scope": "tabs",
  "commit_subject": "add Chrome-style dynamic tabs with dirty indicator",
  "commit_body": "Implement EditorTab component...",
  "pr_description": "## Summary\n- Add Chrome-style tabs\n- Add dirty indicator\n- Add context menu\n\n## Test plan\n- [ ] Verify dynamic resizing\n- [ ] Verify dirty indicator"
}
```

---

## Commit Message Template

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

Closes #<number>
EOF
)"
```
