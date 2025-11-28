# Phase 8: User Acceptance Testing (UAT)

**Goal:** Verify changes work correctly in running application before committing.
**Skip for:** Tier 1 (trivial changes)

## Steps

1. **Build the Project**
   ```bash
   npm run build
   ```
   Verify build completes without errors.

2. **Start Development Server**
   ```bash
   npm run dev
   ```
   Launch the application for manual testing.

3. **Request Manual Testing**
   Ask user to manually test the implemented functionality against acceptance criteria.

## UAT Checkpoint (Tier 2+)

Present to user:
```markdown
## User Acceptance Testing

The application is running. Please manually test the changes.

**Acceptance Criteria to Verify:**
- [ ] Criterion 1
- [ ] Criterion 2

**How to test:**
1. [Step-by-step testing instructions]
2. [What to look for]

When finished, select an option:
```

**Options:**
- **UAT passed** - All acceptance criteria verified, proceed to finalization
- **Found issues** - Problems discovered during testing (please describe)
- **Skip UAT** - Skip manual testing (Tier 1 only)

## If Issues Found

1. Stop the dev server
2. Fix the reported issues
3. Re-run quality gates (`npm test`, `npm run typecheck`)
4. Restart UAT from Step 1

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review user feedback on issues found
  2. Fix issues and rebuild
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Build completed successfully without errors
- [ ] Development server started without crashes
- [ ] User manually tested all acceptance criteria
- [ ] User confirmed UAT passed (or explicitly chose to skip for Tier 1)
- [ ] No issues found, or all found issues have been resolved

**STOP if any item unchecked. Do not proceed.**
