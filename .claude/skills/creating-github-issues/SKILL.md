---
name: creating-github-issues
description: Create Claude Code-friendly GitHub issues from user problem descriptions. Guides through codebase analysis, clarifying questions, issue classification (bug/enhancement), and structured issue creation using gh CLI. Use when user reports a bug, requests a feature, mentions creating an issue, or discusses problems that should be tracked in GitHub Issues.
---

# Creating GitHub Issues

This skill helps create well-structured GitHub issues that are optimized for future Claude Code sessions to understand and implement.

## When This Skill Applies

Activate this skill when the user:
- Reports a bug or unexpected behavior
- Requests a new feature or enhancement
- Mentions wanting to "create an issue" or "track this"
- Discusses a problem that should be documented for later
- Asks to file something in GitHub Issues

## Core Principle

**All GitHub Issues activities MUST be initialized by the user.** Never create, modify, or close issues without explicit user instruction. Always ask for approval before running `gh issue create`.

## Workflow Protocol

### Phase 1: Understand the Problem

1. Listen to the user's description carefully
2. If the problem relates to code behavior, optionally research the codebase to understand context (but don't reference specific file paths in the issue)
3. Identify the type of issue:
   - **Bug**: Something isn't working as expected
   - **Enhancement**: New feature or improvement request

### Phase 2: Ask Clarifying Questions

Before drafting the issue, gather missing information. Use the AskUserQuestion tool with relevant questions:

**For Bugs:**
- Which areas/features are affected?
- What is the expected vs actual behavior?
- Can you describe steps to reproduce?
- What environment/platform? (OS, version)

**For Enhancements:**
- What problem does this solve?
- What should the expected behavior be?
- Are there specific acceptance criteria?
- Any reference implementations to match? (e.g., "like VS Code")

**For Both:**
- What priority/severity?
- Any related issues to reference?

### Phase 3: Check for Duplicates

Before creating a new issue, search for existing ones:

```bash
gh issue list --search "<keywords>"
gh issue list --state all --limit 20
```

If a duplicate exists, inform the user and suggest referencing or commenting on the existing issue instead.

### Phase 4: Draft the Issue

Based on the issue type, use the appropriate template:

- **Bug reports**: See `templates/bug-report.md`
- **Feature requests**: See `templates/enhancement.md`

**Key principles for Claude Code-friendly issues** (see `reference.md` for details):
- Focus on behavior, not implementation details
- No file paths or line numbers (they change over time)
- Acceptance criteria as checkboxes
- Implementation notes guide research, don't prescribe solutions

### Phase 5: Present and Confirm

1. Show the drafted issue to the user
2. Ask for any modifications
3. **Wait for explicit approval** before creating
4. Only after user confirms, run:

```bash
gh issue create \
  --title "Issue title here" \
  --label "bug" \  # or "enhancement"
  --body "$(cat <<'EOF'
Issue body here...
EOF
)"
```

5. Return the created issue URL to the user

## Available Labels

Use these standard labels (check project for custom labels with `gh label list`):

| Label | When to Use |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `documentation` | Docs improvements |
| `good first issue` | Simple, newcomer-friendly |
| `help wanted` | Extra attention needed |

## Examples

### Example 1: Bug Report Flow

**User says:** "The resize handles are too thin and hard to grab"

**Claude should:**
1. Ask clarifying questions (which panels? what size feels right? hover feedback?)
2. Search for duplicates: `gh issue list --search "resize handle"`
3. Draft issue using bug template
4. Show draft, wait for approval
5. Create with `gh issue create`

**Good issue output:**
```markdown
## Summary
Panel resize handles are difficult to grab with mouse pointer due to narrow hit area.

## Affected Areas
- Project Tree <-> Editor divider
- Editor <-> Terminal divider

## Expected Behavior
- Resize handles should have comfortable grab area (~6-8px)
- Visual feedback on hover

## Acceptance Criteria
- [ ] All dividers have increased hit area
- [ ] Hover state shows visual indicator
- [ ] Consistent UX across all panels
```

### Example 2: Feature Request Flow

**User says:** "I want dark mode support"

**Claude should:**
1. Ask: What should toggle it? System preference or manual? Which components?
2. Check duplicates
3. Draft using enhancement template
4. Confirm and create

## Anti-Patterns (What NOT to Do)

1. **Never create issues without explicit user approval**
2. **Never include file paths or line numbers** - they become outdated
3. **Never prescribe implementation** - let future Claude sessions analyze fresh
4. **Never bulk-modify issues** without per-item approval
5. **Never skip the duplicate check**

## Quick Reference

| Action | Autonomous? |
|--------|-------------|
| Search/list/view issues | Yes |
| Create issue | No - requires approval |
| Edit/close issue | No - requires approval |
| Add labels/comments | No - requires approval |
