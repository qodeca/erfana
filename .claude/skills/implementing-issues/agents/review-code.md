# Agent: review-code

Pre-commit code quality review for implemented changes.

---

## Purpose

Review code changes for quality, security, performance, and best practices before commit.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| files_changed | array | Yes | List of modified file paths |
| acceptance_criteria | array | Yes | Original acceptance criteria |
| implementation_plan | object | No | Approved plan for context |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] files_changed is non-empty array
- [ ] acceptance_criteria has at least 1 item

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Read Changed Files

For each file in files_changed:

```
Read(file_path="<changed_file>")
```

Note the changes made.

### Step 2: Security Review

Check each file for:

**Secrets/Credentials:**
```
Grep(pattern="api[_-]?key|secret|password|token|credential", path="<file>", -i=true)
```

**Injection Vulnerabilities:**
- SQL injection: raw queries with user input
- Command injection: shell commands with variables
- XSS: unescaped HTML output

**Path Traversal:**
- File paths from user input without validation

### Step 3: Performance Review

Check for:
- Unnecessary re-renders (missing deps in useEffect)
- Memory leaks (missing cleanup)
- N+1 queries or loops
- Large bundle additions

### Step 4: Best Practices Review

Check:
- TypeScript types (no `any` without justification)
- Error handling (try/catch where needed)
- Naming conventions match codebase
- Import organization

### Step 5: Test Coverage Review

Verify:
- Tests exist for new code
- Tests cover acceptance criteria
- Edge cases tested

### Step 6: Documentation Review

Check:
- Complex logic has comments
- Public APIs have JSDoc/TSDoc
- No outdated comments

### Step 7: Compile Findings

Categorize by severity:
- **Critical**: Must fix before commit
- **High**: Should fix before commit
- **Medium**: Should fix, can document if deferring
- **Low**: Optional, can defer

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| review_status | string | "approved" / "changes_requested" / "needs_discussion" |
| findings | array | List of review findings with severity |
| critical_issues | array | Issues that MUST be fixed before commit |
| suggestions | array | Optional improvements (non-blocking) |
| security_concerns | array | Security-related findings |

### Finding Structure

```json
{
  "severity": "critical|high|medium|low",
  "category": "security|performance|patterns|testing|documentation",
  "file": "path/to/file.ts",
  "line": 42,
  "issue": "Description of the issue",
  "suggestion": "How to fix"
}
```

### Output Format

```json
{
  "review_status": "changes_requested",
  "findings": [
    {
      "severity": "high",
      "category": "security",
      "file": "src/.../Component.tsx",
      "line": 45,
      "issue": "Missing input validation",
      "suggestion": "Add validation before using user input"
    }
  ],
  "critical_issues": [],
  "suggestions": ["Consider memoizing expensive calculation"],
  "security_concerns": ["Input not validated"]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All files_changed have been reviewed
- [ ] review_status is determined
- [ ] findings array is populated (may be empty)
- [ ] critical_issues extracted from findings

### Review Status Logic

- `approved`: No critical issues, no high severity issues
- `changes_requested`: Has critical or high severity issues
- `needs_discussion`: Has architectural concerns requiring input

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 500 tokens |
| Maximum | 800 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| File not found | Skip file, note in findings |
| Too many files (>20) | Review most critical first |
| Unclear code intent | Request documentation, mark as medium |

---

## Review Checklist

### Security (Always Check)
- [ ] No hardcoded secrets
- [ ] Input validation at boundaries
- [ ] No injection vectors
- [ ] Proper authorization checks

### Performance
- [ ] No unnecessary re-renders
- [ ] Cleanup in useEffect
- [ ] Efficient data structures

### Patterns
- [ ] Follows codebase style
- [ ] Uses established utilities
- [ ] Consistent naming

### Testing
- [ ] Tests cover acceptance criteria
- [ ] Edge cases tested
- [ ] No flaky tests

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "files_changed": [
    "src/.../EditorTab.tsx",
    "src/.../EditorTab.css"
  ],
  "acceptance_criteria": ["Dirty indicator shows", "Context menu works"]
}
```

**Execution:**
```
Read(file_path="src/.../EditorTab.tsx")
→ Review component code

Grep(pattern="api[_-]?key|secret", path="src/.../EditorTab.tsx")
→ No secrets found

→ Check for patterns, performance, tests
```

**Output:**
```json
{
  "review_status": "approved",
  "findings": [
    {
      "severity": "low",
      "category": "performance",
      "file": "src/.../EditorTab.tsx",
      "line": 30,
      "issue": "Context menu items array recreated on each render",
      "suggestion": "Consider useMemo for menu items"
    }
  ],
  "critical_issues": [],
  "suggestions": ["Memoize context menu items"],
  "security_concerns": []
}
```
