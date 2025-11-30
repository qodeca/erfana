# Agent: audit-security

Deep security analysis for critical changes and security-labeled issues.

---

## Purpose

Perform comprehensive security audit focusing on OWASP Top 10 and Electron-specific vulnerabilities.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| files_changed | array | Yes | List of modified file paths |
| issue_labels | array | Yes | Issue labels (check for 'security') |
| tier | number | Yes | Complexity tier (1 or 2) |
| ipc_handlers_modified | boolean | No | Whether IPC handlers were changed |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] files_changed is non-empty array
- [ ] tier is 1 or 2

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Run npm Audit (All Tiers)

```
Bash(command="npm audit --json")
```

Parse results:
- Count vulnerabilities by severity
- Identify production vs dev dependencies
- Note any critical/high issues

### Step 2: Scan for Secrets (All Tiers)

Search for hardcoded secrets:

```
Grep(pattern="api[_-]?key|secret|password|token|credential|private[_-]?key", -i=true)
Grep(pattern="['\"][a-zA-Z0-9]{32,}['\"]")
```

Check for:
- API keys
- Passwords
- Tokens
- Private keys

### Step 3: Check for Dangerous Patterns (All Tiers)

Search for risky code:

```
Grep(pattern="eval\\(|Function\\(|innerHTML|dangerouslySetInnerHTML")
Grep(pattern="child_process|exec\\(|spawn\\(|execSync")
```

### Step 4: Input Validation Review (Tier 2)

For each file handling user input:

```
Read(file_path="<file>")
```

Check:
- All inputs validated before use
- Type checking present
- Length limits enforced
- Sanitization applied

### Step 5: Path Traversal Check (Tier 2)

```
Grep(pattern="readFile|writeFile|unlink|rmdir|access|stat", path="src/main/")
```

For each file operation:
- Verify path validation
- Check for `..` prevention
- Ensure paths are normalized

### Step 6: IPC Security Review (Tier 2)

If ipc_handlers_modified:

```
Grep(pattern="ipcMain.handle|ipcMain.on", path="src/main/")
```

Verify:
- All parameters validated
- No direct shell execution
- Proper error handling

### Step 7: OWASP Top 10 (Tier 2)

For Tier 2 issues, verify each:

| Category | Check |
|----------|-------|
| A01 Broken Access Control | Authorization on all routes |
| A02 Cryptographic Failures | No plaintext secrets |
| A03 Injection | Input validation, parameterized queries |
| A04 Insecure Design | Threat modeling |
| A05 Security Misconfiguration | Secure defaults |
| A06 Vulnerable Components | npm audit clean |
| A07 Auth Failures | Session management |
| A08 Data Integrity | Signed updates |
| A09 Logging Failures | No sensitive data logged |
| A10 SSRF | URL validation |

### Step 8: Compile Results

Aggregate all findings with severity.

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| audit_status | string | "pass" / "fail" / "needs_review" |
| vulnerabilities | array | Found vulnerabilities with severity |
| npm_audit_result | object | Result of npm audit |
| owasp_checklist | object | OWASP Top 10 verification (Tier 2) |
| recommendations | array | Security hardening recommendations |
| blocking_issues | array | Issues that MUST be fixed |

### Vulnerability Structure

```json
{
  "id": "SEC-001",
  "severity": "critical|high|medium|low",
  "category": "injection|auth|xss|exposure|misconfiguration",
  "file": "path/to/file.ts",
  "line": 42,
  "description": "Vulnerability description",
  "cwe": "CWE-XXX",
  "remediation": "How to fix"
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] npm_audit_result populated
- [ ] No critical/high npm vulnerabilities (or documented exceptions)
- [ ] No secrets detected in changed files
- [ ] For Tier 2: owasp_checklist completed

### Blocking Criteria

audit_status = "fail" if ANY:
- Critical or high npm vulnerabilities in production deps
- Secrets detected in code
- Path traversal vulnerability found
- IPC handler accepts unvalidated input

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 600 tokens |
| Maximum | 1000 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| npm audit fails | Document error, continue with code review |
| False positive detected | Document as non-issue with justification |
| Unclear security impact | Escalate to needs_review |

---

## Example

**Input:**
```json
{
  "issue_number": 99,
  "files_changed": ["src/main/services/FileService.ts"],
  "issue_labels": ["security"],
  "tier": 2,
  "ipc_handlers_modified": true
}
```

**Execution:**
```
Bash(command="npm audit --json")
→ Parse vulnerability count

Grep(pattern="api[_-]?key|secret|password", -i=true)
→ No secrets found

Grep(pattern="readFile|writeFile", path="src/main/")
→ Check path validation

Read(file_path="src/main/services/FileService.ts")
→ Review for vulnerabilities
```

**Output:**
```json
{
  "audit_status": "pass",
  "vulnerabilities": [],
  "npm_audit_result": {
    "vulnerabilities": 0,
    "high": 0,
    "critical": 0
  },
  "owasp_checklist": {
    "A01": "pass",
    "A02": "pass",
    "A03": "pass"
  },
  "recommendations": ["Add rate limiting to IPC handlers"],
  "blocking_issues": []
}
```
