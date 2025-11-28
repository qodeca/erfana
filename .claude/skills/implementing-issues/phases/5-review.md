# Phase 5: Review

**Goal:** Validate code quality and catch issues early.
**Agent:** `review-code`
**Skip for:** Tier 1 (trivial changes)

## Steps

1. **Invoke Code Reviewer**

   Follow the `review-code` agent steps (see `agents/review-code.md`):

   1. Read all changed files
   2. Check for security issues (secrets, injection, XSS)
   3. Check performance (re-renders, memory leaks)
   4. Verify best practices (TypeScript types, error handling)
   5. Check test coverage
   6. Compile findings by severity

   **Example inputs:**
   - issue_number: 11
   - files_changed: ["EditorTab.tsx", "EditorTab.css"]
   - acceptance_criteria: ["Dynamic sizing", "Context menu"]

2. **Review Categories**
   - Security vulnerabilities
   - Performance issues
   - Best practices compliance
   - Test coverage adequacy
   - Documentation completeness

3. **Address Findings**
   - Critical: Must fix before proceeding
   - Medium: Should fix, document if deferring
   - Low: Optional, can defer to follow-up issue

## Review Checkpoint (Tier 3)

Present findings to user:
```markdown
## Code Review Results

**Critical Issues:** <count>
- <issue 1>

**Medium Issues:** <count>
- <issue 1>

**Recommendations:**
- <suggestion>

Address all critical issues? [Yes/Defer with justification]
```

## Security Review (Tier 3 only)

For security-sensitive changes, verify:
- [ ] No path traversal vulnerabilities
- [ ] IPC handlers validate input
- [ ] No secrets in code
- [ ] CSP not weakened
- [ ] Dangerous protocols still blocked

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review review-code output, understand issues
  2. Fix identified issues, retry review
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Accept (with documented risks)/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Code review completed successfully
- [ ] All critical issues addressed
- [ ] Medium issues fixed or documented if deferred
- [ ] Security review completed (Tier 3 only)

**STOP if any item unchecked. Do not proceed.**
