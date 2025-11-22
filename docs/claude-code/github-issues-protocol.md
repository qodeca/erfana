# GitHub Issues Protocol for Claude Code

This document defines when and how Claude Code should interact with GitHub Issues in the ERFANA project.

## Core Principle

**All GitHub Issues activities MUST be initialized by the user.** Claude Code must never proactively create, modify, or close issues without explicit user instruction.

## Permission Levels

### Autonomous (No Approval Required)

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

### Requires User Instruction

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

## Workflow Patterns

### Pattern 1: Bug Discovery During Development

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

### Pattern 2: Feature Request Identification

When discussing potential features:

1. **DO**: Document the feature requirements in conversation
2. **DO**: Offer to create an issue when discussion concludes
3. **DO NOT**: Create issues for every idea discussed
4. **WAIT**: For explicit confirmation

### Pattern 3: Linking Issues to Work

When working on a task related to an existing issue:

1. **DO**: Reference issue numbers in commit messages (`Fixes #123`)
2. **DO**: Include `Closes #123` in PR descriptions when appropriate
3. **DO**: Check issue for acceptance criteria before starting
4. **DO NOT**: Close issues manually - let PR merge handle it

### Pattern 4: Issue Triage Assistance

When user asks for help organizing issues:

1. **DO**: List and categorize existing issues
2. **DO**: Suggest label changes or priorities
3. **DO NOT**: Apply changes without approval
4. **WAIT**: For user to approve each change or batch

## Command Reference

### Creating Issues

```bash
# Interactive (prompts for title/body)
gh issue create

# Non-interactive with all details
gh issue create \
  --title "Short descriptive title" \
  --body "Detailed description with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details" \
  --label "bug"

# With milestone
gh issue create --title "Feature X" --label "enhancement" --milestone "v1.0"
```

### Querying Issues

```bash
# JSON output for parsing
gh issue list --json number,title,labels,state,createdAt

# Filter by multiple criteria
gh issue list --label "bug" --state open --assignee "@me"

# Search with GitHub query syntax
gh issue list --search "memory leak in:title,body"
```

### Updating Issues

```bash
# Add labels
gh issue edit 123 --add-label "priority:high"

# Remove labels
gh issue edit 123 --remove-label "needs-triage"

# Update title and body
gh issue edit 123 --title "New title" --body "New description"

# Add to milestone
gh issue edit 123 --milestone "v1.0"
```

### Closing Issues

```bash
# Close with comment
gh issue close 123 --comment "Fixed in PR #125"

# Close as not planned
gh issue close 123 --reason "not planned" --comment "Out of scope"
```

## Available Labels

The project uses these existing labels (do not create new ones without user approval):

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
| `dependencies` | #0366d6 | Dependency updates |
| `javascript` | #168700 | JavaScript code changes |

## Issue Templates

When creating issues, use these formats:

### Bug Report
```markdown
## Description
[Clear description of the bug]

## Steps to Reproduce
1. [First step]
2. [Second step]
3. [...]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- OS: [e.g., macOS 14.0]
- Node: [e.g., 18.x]
- Version: [e.g., 0.4.0]

## Additional Context
[Screenshots, logs, related issues]
```

### Feature Request
```markdown
## Summary
[One-line description]

## Motivation
[Why is this needed? What problem does it solve?]

## Proposed Solution
[How should it work?]

## Alternatives Considered
[Other approaches thought about]

## Additional Context
[Mockups, examples, related features]
```

## Anti-Patterns (What NOT to Do)

1. **Never create issues without explicit user request**
   - Even if a bug is critical
   - Even if the fix is obvious
   - Always inform and wait for approval

2. **Never bulk-modify issues without approval**
   - Don't batch-close "stale" issues
   - Don't mass-relabel without review
   - Each modification needs acknowledgment

3. **Never delete issues**
   - Deletion is permanent and loses history
   - Prefer closing with explanation
   - Only delete if user explicitly requests

4. **Never assign issues to external contributors**
   - Only assign to @me or user-specified assignees
   - Respect project governance

5. **Never create duplicate issues**
   - Always search first: `gh issue list --search "<keywords>"`
   - Reference existing issues instead

## Integration with Project Workflow

### Before Starting Work
```bash
# Check for related issues
gh issue list --search "<feature-name>"
gh issue view <number>  # Read acceptance criteria
```

### During Development
```bash
# Reference in commits
git commit -m "Add feature X

Implements the core functionality for #123"
```

### Creating Pull Requests
```bash
# Link to issue in PR body
gh pr create --title "Add feature X" --body "Closes #123

## Changes
- Added X
- Updated Y"
```

### After PR Merge
- Issues with `Closes #123` syntax auto-close
- If manual close needed, ask user first

## Summary

| Action | Autonomous? | Notes |
|--------|-------------|-------|
| List/view/search issues | Yes | For context gathering |
| Create issue | No | Always ask first |
| Edit issue | No | Describe changes, wait for approval |
| Close issue | No | Prefer PR auto-close |
| Comment on issue | No | Ask before adding comments |
| Label changes | No | Suggest, don't apply |
| Delete issue | No | Almost never appropriate |

**Remember**: GitHub Issues are the user's task management system. Claude Code assists but does not control.
