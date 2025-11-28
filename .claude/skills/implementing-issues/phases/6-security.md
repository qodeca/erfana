# Phase 6: Security Scan (All Tiers)

**Goal:** Catch security issues early (shift-left security).
**Skip for:** None - security scanning applies to ALL changes.

Security is not optional. Every change, regardless of tier, must pass security checks before review.

## Steps

1. **Dependency Vulnerability Scan**
   ```bash
   npm audit
   ```
   Address any high or critical vulnerabilities before proceeding.

2. **Secret Detection**
   - Check for hardcoded secrets, API keys, tokens
   - Review any new environment variables
   - Ensure no credentials in committed code

3. **Static Analysis** (Tier 2)
   - Code patterns that could lead to vulnerabilities
   - Input validation completeness
   - Output encoding for XSS prevention

## Security Scan Checklist

**Basic (All Tiers):**
- [ ] `npm audit` reports no high/critical vulnerabilities
- [ ] No secrets or API keys in committed code
- [ ] No new dangerous dependencies added
- [ ] User input properly validated at entry points

**Full Security Review (Tier 2):**
- [ ] Full `audit-security` agent review
- [ ] OWASP Top 10 verification
- [ ] Path traversal protection verified
- [ ] IPC handlers validate all input
- [ ] CSP not weakened
- [ ] Dangerous protocols blocked

## If Security Issues Found

1. **Critical/High vulnerabilities:** STOP. Fix before proceeding.
2. **Medium vulnerabilities:** Document and fix in this PR if possible.
3. **Low vulnerabilities:** Document, may defer to follow-up issue.

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review scan output, identify root cause
  2. Retry with fixes applied
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip (with justification)/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] `npm audit` passes (no high/critical vulnerabilities)
- [ ] No hardcoded secrets found
- [ ] Static analysis passed (Tier 2)
- [ ] Additional security review completed (Tier 2 only)

**STOP if any item unchecked. Do not proceed.**
