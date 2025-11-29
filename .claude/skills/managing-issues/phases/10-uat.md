# Phase 10: User Acceptance Testing (UAT)

**Goal:** Verify changes work correctly in running application.
**Agent:** None (manual testing)
**Quality Gate:** QG-10 (User-Approval for T2, Automated for T1)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-9 = PASS (Documentation completed)
- [ ] All documentation updated
- [ ] All tests passing
- [ ] Typecheck passing

---

## Execution Steps

### Step 1: Build the Project

```bash
npm run build
```

**Verify:** Build completes without errors.

### Step 2: Start Development Server

```bash
npm run dev
```

**Verify:** Application launches without crashes.

### Step 3: Prepare Test Instructions

Create testing checklist based on acceptance criteria:

```markdown
## Testing Checklist

**Feature:** <feature name>

### Test Steps
1. <step 1>
2. <step 2>
3. <step 3>

### Expected Results
- [ ] <expected result 1>
- [ ] <expected result 2>

### Edge Cases to Test
- [ ] <edge case 1>
- [ ] <edge case 2>
```

### Step 4: Request Manual Testing

Present to user for testing (Tier 2) or verify programmatically (Tier 1).

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Build Output | Successful build |
| Running Application | App starts without errors |
| Test Results | User verification of acceptance criteria |
| Issue List | Any bugs found during testing |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 11.**

- [ ] Build completed successfully
- [ ] Application starts without errors
- [ ] All acceptance criteria manually verified (T2) or auto-verified (T1)
- [ ] No new bugs discovered during testing
- [ ] Edge cases tested (T2)

---

## QUALITY GATE: QG-10

**Gate Type:** User-Approval (T2) | Automated (T1)
**Gate ID:** QG-10

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| Build passes | Required | Required |
| App starts | Required | Required |
| Acceptance criteria | Auto-check | Manual verify |
| Edge cases | Not required | Required |
| User approval | Not required | Required |

### Tier 1: Automated Verification

```bash
npm run build && npm run dev &
# Wait for app to start
# Kill dev server
```

If build succeeds and app starts: QG-10 = PASS

### Tier 2: User Checkpoint

Present to user:

```markdown
## User Acceptance Testing

The application is running. Please manually test the changes.

**Issue:** #<number> - <title>

### Acceptance Criteria to Verify
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <criterion 3>

### How to Test
1. <step-by-step instructions>
2. <what to look for>
3. <expected behavior>

### Edge Cases
- [ ] <edge case 1>
- [ ] <edge case 2>

---

**Select an option:**
- **UAT Passed** - All acceptance criteria verified
- **Found Issues** - Problems discovered (please describe)
- **Need Help** - Require assistance with testing
```

### Result

**QG-10 Result:** [PASS | FAIL]

### On FAIL (Issues Found)

1. Stop the dev server
2. Document reported issues
3. Return to Phase 4 (Implementation) to fix
4. Re-run phases 4-10
5. Max 3 UAT cycles, then ESCALATE

### Common Issues

| Issue | Resolution |
|-------|------------|
| Build fails | Fix build errors, re-run |
| App crashes | Debug, fix, restart |
| Criteria not met | Fix implementation |
| Edge case failure | Add handling |

---

## NEXT PHASE

**QG-10 = PASS required to proceed to Phase 11: Finalization**

**STOP if QG-10 ≠ PASS. Do not proceed.**
