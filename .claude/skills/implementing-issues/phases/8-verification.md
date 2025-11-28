# Phase 8: Implementation Verification

**Goal:** Verify implementation matches approved plan before marking as complete.
**Agent:** `design-solution`
**Skip for:** Tier 1 (trivial changes)

Implementation is NOT complete until architect verifies conformance. This is part of the **Definition of Done**.

## Steps

1. **Invoke Architect for Verification**

   After code review passes and all tests pass, use `design-solution` in verification mode:

   Follow the agent steps (see `agents/design-solution.md`):

   1. Read implemented files
   2. Compare against approved plan
   3. Check acceptance criteria coverage
   4. Verify codebase patterns followed
   5. Assess test coverage
   6. Report [VERIFIED / NEEDS CORRECTION]

   **Verification criteria:**
   - Plan conformance: Does the implementation match the approved design?
   - Acceptance criteria: All requirements from issue implemented?
   - Patterns: Codebase conventions and architecture followed?
   - Test coverage: All changes adequately tested?
   - Technical debt: Any shortcuts or deviations introduced?

2. **Correction Loop (mandatory)**

   ```
   IF architect reports NEEDS CORRECTION:
     1. Re-invoke implement-code to address specific issues
     2. Re-run tests (npm run test)
     3. Re-invoke review-code if substantial changes were made
     4. Re-invoke design-solution for verification
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

## Definition of Done (Phase 8)

Before proceeding to Phase 9, ALL must be true:
- [ ] All tests pass
- [ ] Code review passed (Phase 7)
- [ ] **Architect verification: VERIFIED**

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review architect feedback, understand deviations
  2. Invoke implement-code to address issues, retry verification
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
