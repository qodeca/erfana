# Phase 3: Architecture

**Goal:** Design implementation approach with architect verification.
**Agent:** `design-solution`
**Quality Gate:** QG-3 (User-Approval - ALL tiers)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-2 = PASS (Discovery completed)
- [ ] Affected files list available
- [ ] Patterns inventory available
- [ ] Complexity assessment available
- [ ] Acceptance criteria validated

---

## Execution Steps

### Step 1: Invoke Architect Agent

Use `design-solution` agent to:
1. Read acceptance criteria
2. Review affected files
3. Consider existing patterns
4. Design component structure
5. Plan implementation steps
6. Define test strategy
7. Identify risks

### Step 2: Produce Implementation Plan

Use template: `templates/implement/implementation-plan.md`

Plan must include:
- Approach summary
- Files to modify/create
- Implementation sequence
- Test strategy
- Risks and mitigations

### Step 3: Architect Verification Gate

**BEFORE presenting to user**, verify plan internally:

```
Verification criteria:
- [ ] All acceptance criteria addressed
- [ ] Aligns with existing patterns
- [ ] All risks identified with mitigations
- [ ] Test strategy covers all changes
- [ ] All affected files/modules identified
```

**Report:** [APPROVED | NEEDS REVISION]

### Step 4: Correction Loop (if NEEDS REVISION)

```
IF architect reports NEEDS REVISION:
  1. Address each identified issue
  2. Update the implementation plan
  3. Re-invoke design-solution for verification
  4. Repeat until APPROVED

ONLY present to user after architect APPROVED.
```

### Step 5: Present to User

Present architect-approved plan for user approval.

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Implementation Plan | Complete plan with sequence and tests |
| Architect Verification | APPROVED status |
| Risk Register | All risks with mitigations |
| Test Strategy | How changes will be tested |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 4.**

- [ ] Implementation plan produced by design-solution
- [ ] Plan addresses ALL acceptance criteria
- [ ] All affected files identified in plan
- [ ] Testing strategy defined
- [ ] Risks identified with mitigations
- [ ] Architect verification: APPROVED
- [ ] User approved implementation plan

---

## QUALITY GATE: QG-3

**Gate Type:** User-Approval (ALL tiers)
**Gate ID:** QG-3

### Pass Criteria

| Criterion | Required |
|-----------|----------|
| Plan completeness | All acceptance criteria covered |
| Architect verified | APPROVED (not NEEDS REVISION) |
| User approved | Explicit approval received |

### User Checkpoint

Present to user:

```markdown
## Implementation Plan

**Issue:** #<number> - <title>
**Architect Verification:** APPROVED

### Approach
<summary of approach>

### Changes
| File | Action | Description |
|------|--------|-------------|
| <file1> | Modify | <what changes> |
| <file2> | Create | <purpose> |

### Implementation Sequence
1. <step 1>
2. <step 2>
3. <step 3>

### Test Strategy
- Unit tests: <coverage>
- Integration tests: <scope>
- Edge cases: <list>

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| <risk> | <impact> | <action> |

### Estimated Effort
<effort assessment>

**Approve plan?** [Approve / Revise / Abort]
```

### Result

**QG-3 Result:** [PASS | FAIL]

### On FAIL

If user requests revision:
1. Gather specific feedback
2. Re-invoke design-solution with feedback
3. Re-run architect verification
4. Present revised plan
5. Max 3 revision cycles, then discuss alternatives

### Abort Criteria

- Issue is poorly scoped → Request issue refinement
- Breaking changes not labeled → Request label update
- Blocked by missing dependency → Document blocker

---

## NEXT PHASE

**QG-3 = PASS (user approved) required to proceed to Phase 4: Implementation**

**STOP if QG-3 ≠ PASS. Do not proceed.**
