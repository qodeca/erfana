# Phase 8: Implementation Verification

**Goal:** Verify implementation matches approved plan.
**Agent:** `design-solution` (verify mode)
**Quality Gate:** QG-8 (Mandatory - Definition of Done)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-7 = PASS (Quality Review completed)
- [ ] All tests passing
- [ ] Typecheck passing
- [ ] Original implementation plan available
- [ ] All acceptance criteria documented

---

## CRITICAL: Verification is Definition of Done

Implementation is NOT complete until architect verifies conformance.

**QG-8 is MANDATORY. This gate cannot be overridden.**

---

## Execution Steps

### Step 1: Invoke Architect for Verification

Use `design-solution` in verification mode:

1. Read implemented files
2. Compare against approved plan
3. Check acceptance criteria coverage
4. Verify codebase patterns followed
5. Assess test coverage adequacy
6. Report [VERIFIED | NEEDS CORRECTION]

### Step 2: Verification Criteria

| Criterion | Question |
|-----------|----------|
| Plan conformance | Does implementation match approved design? |
| Acceptance criteria | All requirements implemented? |
| Patterns | Codebase conventions followed? |
| Test coverage | All changes adequately tested? |
| Technical debt | Any shortcuts or deviations? |

### Step 3: Correction Loop (if NEEDS CORRECTION)

```
IF architect reports NEEDS CORRECTION:
  1. Re-invoke implement-code to address specific issues
  2. Re-run tests (npm run test)
  3. Re-run typecheck (npm run typecheck)
  4. Re-invoke review-code if substantial changes
  5. Re-invoke design-solution for verification
  6. Repeat until VERIFIED

ONLY proceed to Documentation after architect VERIFIED.
```

### Step 4: Document Deviations

If any deviations from plan:
- Document what changed
- Explain why deviation was necessary
- Confirm no acceptance criteria compromised

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Verification Report | VERIFIED or NEEDS CORRECTION |
| Plan Conformance | How well implementation matches plan |
| Deviations List | Any changes from original plan |
| Acceptance Verification | Per-criterion status |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 9.**

- [ ] Architect verification completed
- [ ] Verification status: VERIFIED (not NEEDS CORRECTION)
- [ ] All deviations documented and justified
- [ ] Implementation matches approved plan
- [ ] All acceptance criteria verified as met
- [ ] No unplanned changes introduced

---

## QUALITY GATE: QG-8

**Gate Type:** Mandatory (ALL tiers - Definition of Done)
**Gate ID:** QG-8

### Pass Criteria

| Criterion | Required |
|-----------|----------|
| Architect status | VERIFIED |
| Plan conformance | Full match or justified deviations |
| Acceptance criteria | ALL criteria met |
| Can be overridden | **NO** |

### Verification Checkpoint

Present to user:

```markdown
## Implementation Verification

**Architect Status:** [VERIFIED | NEEDS CORRECTION]

### Plan Conformance
<assessment of how well implementation matches plan>

### Acceptance Criteria Verification
| Criterion | Status | Evidence |
|-----------|--------|----------|
| <criterion 1> | ✅/❌ | <where verified> |
| <criterion 2> | ✅/❌ | <where verified> |

### Deviations (if any)
| Planned | Actual | Justification |
|---------|--------|---------------|
| <original> | <changed> | <why> |

### Quality Confirmation
- Tests: All passing
- Types: All passing
- Coverage: >80%

**Proceed to Documentation?** [Approve / Address Issues]
```

### Result

**QG-8 Result:** [PASS | FAIL]

### On FAIL (NEEDS CORRECTION)

1. Review architect feedback
2. Identify specific issues to address
3. Re-invoke implement-code for fixes
4. Re-run verification
5. Max 3 correction cycles, then ESCALATE

### On ESCALATE

If cannot achieve VERIFIED after 3 attempts:
1. Present detailed findings to user
2. User must decide: [Retry | Accept with documented deviations | Abort]
3. If accepting deviations: Document in commit message

---

## NEXT PHASE

**QG-8 = PASS (VERIFIED) required to proceed to Phase 9: Documentation**

**STOP if QG-8 ≠ PASS. Do not proceed.**
