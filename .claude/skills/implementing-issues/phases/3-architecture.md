# Phase 3: Architecture

**Goal:** Design the implementation approach.
**Agent:** `design-solution`

## Steps

### 1. Invoke Architect Agent

Follow the `design-solution` agent steps (see `agents/design-solution.md`):

1. Read acceptance criteria from issue
2. Search for affected files using Glob/Grep
3. Read existing code patterns
4. Design component structure
5. Plan implementation steps
6. Define test strategy
7. Identify risks

**Example inputs:**
- issue_number: 11
- issue_body: "Add Chrome-style tabs"
- acceptance_criteria: [sizing, dirty indicator, context menu]
- affected_files: [from explore-codebase]
- patterns_found: [from explore-codebase]

### 2. Produce Implementation Plan

Use template: `templates/implementation-plan.md`

### 3. Identify Agent Needs

Based on issue type:
- Feature: implement-code (required)
- Bug fix (complex): investigate-bug
- Refactor: advise-refactor
- Tests only: write-tests

### 4. Plan Verification Gate (Definition of Done - Tier 2+)

BEFORE presenting plan to user, verify the plan using `design-solution` verification mode:

**Verification criteria:**
- Completeness: All acceptance criteria addressed?
- Feasibility: Aligns with existing codebase patterns?
- Risks: All risks identified with mitigations?
- Testing: Strategy covers all changes adequately?
- Dependencies: All affected files/modules identified?

**Report:** [APPROVED / NEEDS REVISION]

If NEEDS REVISION, provide specific issues to address.

**Correction Loop (mandatory):**

```
IF architect reports NEEDS REVISION:
  1. Address each identified issue
  2. Update the implementation plan
  3. Re-invoke design-solution for verification
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

- [ ] Implementation plan produced by design-solution
- [ ] Plan addresses all acceptance criteria
- [ ] All affected files identified
- [ ] Testing strategy defined
- [ ] Risks identified with mitigations
- [ ] Architect verification: APPROVED (Tier 2+)
- [ ] User approved architecture checkpoint (Tier 2+)

**STOP if any item unchecked. Do not proceed.**
