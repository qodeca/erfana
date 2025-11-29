# Phase 4: Implementation

**Goal:** Write code and tests following the approved plan.
**Agents:** `implement-code`, `write-tests`
**Quality Gate:** QG-4 (Automated)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-3 = PASS (Architecture approved by user)
- [ ] Implementation plan available and APPROVED
- [ ] Test strategy defined
- [ ] Affected files list available
- [ ] Patterns inventory available

---

## Execution Steps

### Step 1: Implementation with implement-code

Follow `implement-code` agent:

1. Review implementation plan
2. Read existing code patterns
3. Create new files using Write()
4. Modify existing files using Edit()
5. Verify with `npm run typecheck`

**Follow the plan sequence exactly.**

### Step 2: Write Tests (TDD-friendly)

Use `write-tests` agent for:
- Unit tests for new functions
- Integration tests for components
- Edge case coverage

**Target:** >80% coverage for new code

### Step 3: Incremental Verification

After each major change:
```bash
npm run typecheck    # Must pass
npm run test         # Must pass
```

### Step 4: Modern Testing Approaches (Tier 2)

Consider where applicable:

| Approach | When to Use |
|----------|-------------|
| Property-based | Complex input domains |
| Contract testing | IPC handlers, APIs |
| AI-assisted generation | Edge case discovery |
| Mutation testing | Verify test quality |

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Code Changes | New/modified files per plan |
| Test Suite | Tests for all new code |
| Type Check Results | `npm run typecheck` output |
| Test Results | `npm run test` output |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 5.**

- [ ] All planned files created/modified
- [ ] Implementation follows approved plan
- [ ] Code follows existing codebase patterns
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] All tests pass (`npm run test`)
- [ ] Tests written for new code (>80% coverage target)
- [ ] No scope creep (only acceptance criteria addressed)

---

## QUALITY GATE: QG-4

**Gate Type:** Automated (ALL tiers)
**Gate ID:** QG-4

### Pass Criteria

| Criterion | Check |
|-----------|-------|
| Typecheck | `npm run typecheck` exits 0 |
| Tests | `npm run test` exits 0 |
| Coverage | New code >80% covered |
| Plan conformance | All planned changes made |
| No scope creep | Only acceptance criteria addressed |

### Automated Verification

```bash
# Run all checks
npm run typecheck && npm run test
```

**Both must pass.**

### Result

**QG-4 Result:** [PASS | FAIL]

### On FAIL

1. Identify specific failure (typecheck, test, coverage)
2. Fix the identified issue
3. Re-run verification
4. Max 3 retries, then ESCALATE

### Common Failures

| Failure | Resolution |
|---------|------------|
| Type error | Fix type annotations or implementation |
| Test failure | Debug and fix implementation or test |
| Low coverage | Add missing tests |
| Scope creep detected | Revert unplanned changes |

---

## Implementation Guidelines

**DO:**
- Follow existing patterns in codebase
- Keep changes focused on acceptance criteria
- Write tests alongside implementation
- Verify after each major change

**DO NOT:**
- Add unplanned features ("while I'm here...")
- Change unrelated code
- Skip test writing
- Ignore typecheck warnings

---

## NEXT PHASE

**QG-4 = PASS required to proceed to Phase 5: Architectural Review**

**STOP if QG-4 ≠ PASS. Do not proceed.**
