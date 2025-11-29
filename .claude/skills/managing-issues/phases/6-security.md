# Phase 6: Security Scan

**Goal:** Catch security issues early (shift-left security).
**Agent:** `audit-security`
**Quality Gate:** QG-6 (Mandatory - NEVER skippable)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-5 = PASS (Architectural Review completed)
- [ ] All tests passing
- [ ] Typecheck passing
- [ ] Implementation complete

---

## CRITICAL: Security is NOT Optional

**QG-6 is MANDATORY for ALL tiers. NO exceptions. NO overrides.**

Every change, regardless of size or tier, must pass security checks.

---

## Execution Steps

### Step 1: Dependency Vulnerability Scan

```bash
npm audit
```

**Action by severity:**
| Severity | Action |
|----------|--------|
| Critical | STOP - Must fix before proceeding |
| High | STOP - Must fix before proceeding |
| Medium | Document, fix if possible |
| Low | Document, may defer |

### Step 2: Secret Detection

Check for:
- [ ] Hardcoded secrets
- [ ] API keys
- [ ] Tokens
- [ ] Credentials
- [ ] Environment variable leaks

```bash
# Search for common secret patterns
grep -r "api[_-]?key\|secret\|password\|token\|credential" --include="*.ts" --include="*.tsx"
```

### Step 3: Static Analysis (Tier 2)

Code patterns to check:
- [ ] Input validation completeness
- [ ] Output encoding for XSS
- [ ] Path traversal protection
- [ ] Injection vulnerabilities
- [ ] Unsafe eval/Function usage

### Step 4: OWASP Verification (Tier 2)

Verify against OWASP Top 10:
- [ ] A01: Broken Access Control
- [ ] A02: Cryptographic Failures
- [ ] A03: Injection
- [ ] A04: Insecure Design
- [ ] A05: Security Misconfiguration
- [ ] A06: Vulnerable Components
- [ ] A07: Authentication Failures
- [ ] A08: Data Integrity Failures
- [ ] A09: Logging Failures
- [ ] A10: Server-Side Request Forgery

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| npm audit Results | Dependency vulnerability report |
| Secret Scan Results | Any secrets found |
| Static Analysis | Code pattern findings |
| OWASP Checklist | Verification results (T2) |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 7.**

- [ ] `npm audit` reports no high/critical vulnerabilities
- [ ] No secrets or API keys in committed code
- [ ] No new dangerous dependencies added
- [ ] User input properly validated at entry points
- [ ] IPC handlers validate all input (if applicable)
- [ ] CSP not weakened (if applicable)
- [ ] OWASP verification complete (Tier 2)

---

## QUALITY GATE: QG-6

**Gate Type:** Mandatory (ALL tiers - NEVER skippable)
**Gate ID:** QG-6

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| npm audit | No high/critical | No high/critical |
| Secrets scan | No secrets found | No secrets found |
| Input validation | Basic check | Full verification |
| OWASP check | N/A | All items verified |
| Can be overridden | **NO** | **NO** |

### Security Checklist

**Basic (ALL Tiers):**
- [ ] `npm audit` passes (no high/critical)
- [ ] No secrets in code
- [ ] No dangerous dependencies
- [ ] Input validation present

**Full (Tier 2):**
- [ ] Full `audit-security` agent review
- [ ] OWASP Top 10 verification
- [ ] Path traversal protection
- [ ] IPC validation
- [ ] CSP maintained
- [ ] Dangerous protocols blocked

### Result

**QG-6 Result:** [PASS | FAIL]

### On FAIL

**Critical/High vulnerabilities:**
1. STOP immediately
2. Fix vulnerability before any other action
3. Re-run `npm audit`
4. Do not proceed until resolved

**Medium vulnerabilities:**
1. Document the vulnerability
2. Fix in this PR if feasible
3. Create follow-up issue if deferring

**Secrets found:**
1. STOP immediately
2. Remove secrets
3. Rotate any exposed credentials
4. Add to .gitignore if needed
5. Re-scan

### On ESCALATE

If cannot fix after 3 retries:
1. Present security findings to user
2. User must decide: [Fix | Abort]
3. **Override is NOT an option for security**

---

## NEXT PHASE

**QG-6 = PASS required to proceed to Phase 7: Quality Review**

**STOP if QG-6 ≠ PASS. Do not proceed. Security is mandatory.**
