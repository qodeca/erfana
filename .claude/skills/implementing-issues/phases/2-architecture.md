# Phase 2: Architecture

**Goal:** Design the implementation approach.
**Agent:** `solution-architect`

## Steps

### 1. Invoke Architect Agent

Use the Task tool to spawn the solution-architect agent:

```
Task(subagent_type='solution-architect')

Prompt: "Design implementation for issue #11 - Add Chrome-style tabs

Acceptance criteria:
- Dynamic tab sizing (min 80px, max 300px)
- Dirty indicator for unsaved changes
- Context menu (Close, Close Others, Close All)

Affected areas:
- src/renderer/src/components/Tabs/
- DockviewReact tab components

Existing patterns:
- Review WelcomeTab.tsx for component structure
- Check useProjectStore for state management

Deliverable: Implementation plan with file changes, risks, and estimates."
```

### 2. Produce Implementation Plan

Use template: `templates/implementation-plan.md`

### 3. Identify Agent Needs

Based on issue type:
- Feature: code-implementer (required)
- Bug fix (complex): bug-investigator
- Refactor: refactoring-advisor
- Tests only: test-writer

### 4. Plan Verification Gate (Definition of Done - Tier 2+)

BEFORE presenting plan to user, solution-architect verifies the plan:

```
Task(subagent_type='solution-architect')

Prompt: "Verify implementation plan for issue #<number>:

Plan to verify:
<include the generated implementation plan>

Verification criteria:
- Completeness: All acceptance criteria addressed?
- Feasibility: Aligns with existing codebase patterns?
- Risks: All risks identified with mitigations?
- Testing: Strategy covers all changes adequately?
- Dependencies: All affected files/modules identified?

Report: [APPROVED / NEEDS REVISION]

If NEEDS REVISION, provide specific issues to address."
```

**Correction Loop (mandatory):**

```
IF architect reports NEEDS REVISION:
  1. Address each identified issue
  2. Update the implementation plan
  3. Re-invoke solution-architect for verification
  4. Repeat until APPROVED

ONLY proceed to user checkpoint after architect APPROVED.
```

This gate ensures users only see architect-approved plans.

## Architecture Checkpoint (Tier 2+)

Present implementation plan to user:

```markdown
## Implementation Plan

**Approach:** <summary>

**Changes:**
1. <file>: <change description>
2. <file>: <change description>

**New Files:**
- <path>: <purpose>

**Tests Required:**
- <test type>: <coverage area>

**Risks:**
- <potential issue>

**Estimated Effort:** <time>

Approve plan? [Yes/Revise/Abort]
```

## Abort Criteria

- Issue is poorly scoped → Request issue refinement
- Requires breaking changes not labeled → Request label update
- Blocked by missing dependency → Document blocker

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review architect output, refine prompt with more context
  2. Retry with adjusted parameters or clearer requirements
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Revise Requirements/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Implementation plan produced by solution-architect
- [ ] Plan addresses all acceptance criteria
- [ ] All affected files identified
- [ ] Testing strategy defined
- [ ] Risks identified with mitigations
- [ ] Architect verification: APPROVED (Tier 2+)
- [ ] User approved architecture checkpoint (Tier 2+)

**STOP if any item unchecked. Do not proceed.**
