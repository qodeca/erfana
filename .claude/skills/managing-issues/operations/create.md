# Operation: Create

Create well-structured GitHub issues optimized for future Claude Code sessions.

---

## Overview

| Attribute | Value |
|-----------|-------|
| Phases | 5 |
| Checkpoints | 2 (Duplicate check, Final approval) |
| Agent | draft-issue |
| Autonomy | Low (requires user approval) |

---

## When to Use

Activate when user:
- Reports a bug or unexpected behavior
- Requests a new feature or enhancement
- Mentions wanting to "create an issue" or "track this"
- Discusses a problem that should be documented
- Asks to file something in GitHub Issues

---

## Core Principle

**All issue creation activities MUST be initialized by the user.** Never create, modify, or close issues without explicit user instruction. Always ask for approval before running `gh issue create`.

---

## Workflow

### Phase 1: Understand the Problem

#### Input Conditions
- [ ] User has described a problem or feature request

#### Execution
1. Listen to user's description carefully
2. Optionally research codebase to understand context
3. Classify issue type:
   - **Bug**: Something isn't working as expected
   - **Enhancement**: New feature or improvement request

#### Post-Step Validation
- [ ] Problem understood
- [ ] Issue type determined

#### Quality Gate
If validation fails: Ask user for clarification (max 3 attempts), then escalate.

---

### Phase 2: Ask Clarifying Questions

#### Input Conditions
- [ ] Phase 1 complete
- [ ] Issue type determined

#### Execution
Delegate to: `agents/draft-issue.md` (gather-requirements mode)

Use AskUserQuestion tool with relevant questions:

**For Bugs:**
- Which areas/features are affected?
- What is the expected vs actual behavior?
- Can you describe steps to reproduce?
- What environment/platform? (OS, version)

**For Enhancements:**
- What problem does this solve?
- What should the expected behavior be?
- Are there specific acceptance criteria?
- Any reference implementations? (e.g., "like VS Code")

**For Both:**
- What priority/severity?
- Any related issues to reference?

#### Post-Step Validation
- [ ] All essential questions answered
- [ ] No conflicting requirements

#### Quality Gate
If user skips questions: Re-present with explanation (max 3 attempts), then proceed with available info.
If conflicting answers: Ask for clarification (max 3 attempts), then escalate to user.

---

### Phase 3: Check for Duplicates

#### Input Conditions
- [ ] Phase 2 complete
- [ ] Requirements gathered

#### Execution
Search for existing issues:

```bash
gh issue list --search "<keywords>"
gh issue list --state all --limit 20
```

#### Quality Gate
- If duplicate exists: Inform user, suggest referencing existing issue
- If no duplicate: Proceed to Phase 4
- If gh CLI fails: Retry (max 3 attempts), then inform user and proceed without duplicate check

#### Post-Step Validation
- [ ] Duplicate check performed
- [ ] Decision made (proceed or reference existing)

**Checkpoint**: If potential duplicate found, present to user for decision.

---

### Phase 4: Draft the Issue

#### Input Conditions
- [ ] Phase 3 complete (no blocking duplicate)
- [ ] Requirements gathered

#### Execution
Delegate to: `agents/draft-issue.md` (draft mode)

Based on issue type, use appropriate template:
- **Bug reports**: See `templates/create/bug-report.md`
- **Feature requests**: See `templates/create/enhancement.md`

**Key principles for Claude Code-friendly issues:**
- Focus on behavior, not implementation details
- No file paths or line numbers (they change over time)
- Acceptance criteria as checkboxes
- Implementation notes guide research, don't prescribe solutions

See [reference/claude-code-friendly-issues.md](../reference/claude-code-friendly-issues.md) for details.

#### Post-Step Validation
- [ ] Issue follows template structure
- [ ] No file paths or line numbers
- [ ] Acceptance criteria are testable checkboxes

#### Quality Gate
If draft fails validation: Revise draft (max 3 attempts), then present best effort to user.
If agent fails: Retry agent invocation (max 3 attempts), then escalate to manual drafting.

---

### Phase 5: Present and Confirm

#### Input Conditions
- [ ] Phase 4 complete
- [ ] Draft issue ready

#### Execution
1. Show drafted issue to user
2. Ask for any modifications
3. **Wait for explicit approval** before creating

#### Quality Gate (CHECKPOINT)
- [ ] User has reviewed draft
- [ ] User has explicitly approved

#### On Approval
```bash
gh issue create \
  --title "Issue title here" \
  --label "bug" \  # or "enhancement"
  --body "$(cat <<'EOF'
Issue body here...
EOF
)"
```

Return created issue URL to user.

---

## Autonomy Reference

| Action | Autonomous? |
|--------|-------------|
| Search/list/view issues | Yes |
| Create issue | No - requires approval |
| Edit/close issue | No - requires approval |
| Add labels/comments | No - requires approval |

---

## Error Handling

| Error | Response |
|-------|----------|
| gh CLI not installed | Inform user, provide install instructions |
| Not authenticated | Run `gh auth login` |
| Duplicate found | Present options: reference, comment, or proceed anyway |
| User cancels | Acknowledge, offer to save draft |

---

## Example Flow

**User says:** "The resize handles are too thin and hard to grab"

**Operation does:**
1. **Phase 1**: Understand - Bug affecting resize interaction
2. **Phase 2**: Ask questions via AskUserQuestion
   - Which panels? (Project Tree, Editor, Terminal dividers)
   - What size feels right? (6-8px)
   - Hover feedback needed? (Yes, teal accent)
3. **Phase 3**: Search duplicates: `gh issue list --search "resize handle"`
4. **Phase 4**: Draft using bug template
5. **Phase 5**: Present draft, wait for approval, create with `gh issue create`

**Result:** Issue created with URL returned to user.
