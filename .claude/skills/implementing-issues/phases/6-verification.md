# Phase 6: Implementation Verification

**Goal:** Verify implementation matches approved plan before marking as complete.
**Agent:** `solution-architect`
**Skip for:** Tier 1 (trivial changes)

Implementation is NOT complete until architect verifies conformance. This is part of the **Definition of Done**.

## Steps

1. **Invoke Architect for Verification**

   After code review passes and all tests pass, verify implementation integrity:

   ```
   Task(subagent_type='solution-architect')

   Prompt: "Verify implementation for issue #<number> against approved plan:

   Approved plan summary:
   <include key points from the approved implementation plan>

   Implemented changes:
   <list of files changed/created>

   Verification criteria:
   - Plan conformance: Does the implementation match the approved design?
   - Acceptance criteria: All requirements from issue implemented?
   - Patterns: Codebase conventions and architecture followed?
   - Test coverage: All changes adequately tested?
   - Technical debt: Any shortcuts or deviations introduced?

   Report: [VERIFIED / NEEDS CORRECTION]

   If NEEDS CORRECTION, provide specific issues to address."
   ```

2. **Correction Loop (mandatory)**

   ```
   IF architect reports NEEDS CORRECTION:
     1. Re-invoke code-implementer to address specific issues
     2. Re-run tests (npm run test)
     3. Re-invoke code-reviewer if substantial changes were made
     4. Re-invoke solution-architect for verification
     5. Repeat until VERIFIED

   ONLY proceed to Documentation after architect VERIFIED.
   ```

## Implementation Verification Checkpoint (Tier 2+)

Present verification result to user:
```markdown
## Implementation Verification

**Status:** [VERIFIED / NEEDS CORRECTION]

**Plan Conformance:**
- <assessment of how well implementation matches plan>

**Deviations (if any):**
- <list any deviations from original plan>

**Recommendations:**
- <any suggestions for improvement>

[Proceed to Documentation / Address Issues]
```

## Definition of Done (Phase 6)

Before proceeding to Phase 7, ALL must be true:
- [ ] All tests pass
- [ ] Code review passed (Phase 5)
- [ ] **Architect verification: VERIFIED**

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review architect feedback, understand deviations
  2. Invoke code-implementer to address issues, retry verification
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Accept deviations (with documentation)/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Architect verification completed
- [ ] Verification status: VERIFIED (not NEEDS CORRECTION)
- [ ] All deviations documented and justified
- [ ] Implementation matches approved plan
- [ ] All acceptance criteria met

**STOP if any item unchecked. Do not proceed.**
