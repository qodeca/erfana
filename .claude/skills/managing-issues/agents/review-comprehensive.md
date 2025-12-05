# Agent: review-comprehensive

Comprehensive code review following 2025 industry standards for Electron, Node.js, React, and TypeScript.

---

## Purpose

Execute a full-spectrum code review covering security, architecture, quality, performance, and technology-specific best practices. This agent enforces the standards defined in `reference/code-review-standards-2025.md`.

**MANDATORY:** This review is required for ALL file-modifying operations.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| files_changed | array | Yes | Non-empty list of file paths |
| tier | number | Yes | 1 (Trivial) or 2 (Standard) |
| context | object | No | Issue number, acceptance criteria, plan |

### Input Validation

BEFORE execution, verify:
- [ ] files_changed is non-empty array
- [ ] tier is 1 or 2
- [ ] All file paths exist

**If ANY validation fails: STOP, return error with details.**

---

## Review Dimensions

| Dimension | Tier 1 | Tier 2 | Blocking |
|-----------|:------:|:------:|:--------:|
| Security (Electron) | ✅ | ✅ | YES |
| Security (General) | ✅ | ✅ | YES |
| TypeScript Safety | ✅ | ✅ | YES |
| SOLID Principles | Basic | Full | Tier 2 |
| Code Smells | Critical | All | Tier 2 |
| Complexity | ✅ | ✅ | YES (>20) |
| React Patterns | ✅ | ✅ | YES |
| Node.js Patterns | ✅ | ✅ | YES |
| Performance | Basic | Full | Tier 2 |
| Test Coverage | ✅ | ✅ | YES |
| Documentation | Basic | Full | NO |

---

## Execution Steps

### Step 1: Categorize files by type

```
For each file in files_changed:
  - .ts/.tsx in src/main/ → Electron Main Process
  - .ts/.tsx in src/renderer/ → React/Renderer
  - .ts/.tsx in src/preload/ → Preload Scripts
  - .ts/.tsx in src/shared/ → Shared Code
  - .test.ts/.test.tsx → Test Files
  - .css/.module.css → Styles
```

Apply relevant checklists based on file type.

---

### Step 2: Electron security review (MANDATORY for main/preload)

**Reference:** `reference/code-review-standards-2025.md` Section 2

**2.1 webPreferences validation:**
```
Grep(pattern="nodeIntegration:\\s*true", path="src/main/")
Grep(pattern="contextIsolation:\\s*false", path="src/main/")
Grep(pattern="webSecurity:\\s*false", path="src/main/")
Grep(pattern="sandbox:\\s*false", path="src/main/")
```

**Finding if ANY match:** CRITICAL - "Insecure Electron configuration"

**2.2 IPC security:**
```
Grep(pattern="ipcMain\\.(on|handle)", path="src/main/")
```

For each handler found, verify:
- [ ] Validates `event.senderFrame` or `event.sender`
- [ ] Validates input data
- [ ] No direct file system access with user input

**2.3 Dangerous patterns:**
```
Grep(pattern="shell\\.openExternal", path="src/")
Grep(pattern="eval\\(|new Function\\(", path="src/")
Grep(pattern="innerHTML\\s*=", path="src/")
Grep(pattern="child_process", path="src/main/")
```

**Finding if match without validation:** CRITICAL

---

### Step 3: General security review (ALL files)

**Reference:** `reference/code-review-standards-2025.md` Section 3.2

**3.1 Secrets detection:**
```
Grep(pattern="api[_-]?key|secret|password|token|credential", path="<files>", -i=true)
Grep(pattern="-----BEGIN.*PRIVATE KEY", path="<files>")
```

**Finding if match:** CRITICAL - "Hardcoded secret detected"

**3.2 Injection vulnerabilities:**
```
# SQL injection
Grep(pattern="execute\\(.*\\$|query\\(.*\\+", path="<files>")

# Command injection
Grep(pattern="exec\\(.*\\$|spawn\\(.*\\$", path="<files>")

# Path traversal
Grep(pattern="readFile.*req\\.|readFileSync.*req\\.", path="<files>")
```

---

### Step 4: TypeScript safety review (ALL .ts/.tsx)

**Reference:** `reference/code-review-standards-2025.md` Section 5

**4.1 Type safety violations:**
```
Grep(pattern=": any(?![a-zA-Z])", path="<files>")
→ Count occurrences, flag if > 0

Grep(pattern="as [A-Z][a-zA-Z]+(?!\\s*\\()", path="<files>")
→ Flag each as MEDIUM unless at validated boundary

Grep(pattern="!\\.", path="<files>")
→ Flag non-null assertions as MEDIUM
```

**4.2 Missing strict mode:**
```
Read(file_path="tsconfig.json")
→ Verify "strict": true
→ If false: CRITICAL - "TypeScript strict mode disabled"
```

---

### Step 5: SOLID principles review

**Reference:** `reference/code-review-standards-2025.md` Section 6

**5.1 Single Responsibility (SRP):**
```
For each file in files_changed:
  - Count lines (>300 = HIGH)
  - Count exports (>10 = MEDIUM)
  - Check for mixed imports (UI + API + Store = MEDIUM)
```

**5.2 Open/Closed (OCP):**
```
Grep(pattern="switch\\s*\\([^)]*type|kind|status", path="<files>")
Grep(pattern="if.*typeof.*===|instanceof", path="<files>")
→ Flag growing type switches as MEDIUM
```

**5.3 Dependency Inversion (DIP):**
```
Grep(pattern="new [A-Z][a-zA-Z]+Service|new [A-Z][a-zA-Z]+Repository", path="<files>")
→ Flag direct instantiation as MEDIUM
```

**Tier 2 Only: Full SOLID analysis with LSP and ISP checks.**

---

### Step 6: Code smells detection

**Reference:** `reference/code-review-standards-2025.md` Section 7

**6.1 Method-level:**
```
For each function/method:
  - Lines > 50 → HIGH "Long Method"
  - Parameters > 5 → HIGH "Long Parameter List"
```

**6.2 Class-level:**
```
For each class/component:
  - Lines > 300 → HIGH "Large Class"
  - Lines > 500 OR methods > 15 → CRITICAL "God Class"
```

**6.3 Code-level:**
```
Grep(pattern="\\b[0-9]{2,}\\b(?!px|em|rem|%)", path="<files>")
→ Flag magic numbers as LOW

Grep(pattern="console\\.(log|debug|info)", path="src/")
→ Flag debug code as MEDIUM (except in development utils)
```

---

### Step 7: Complexity analysis

**Reference:** `reference/code-review-standards-2025.md` Section 8

For each function:
- Count decision points (if, else, switch, case, &&, ||, ?)
- Cyclomatic complexity = edges - nodes + 2

| Score | Tier 1 | Tier 2 |
|-------|--------|--------|
| 1-10 | OK | OK |
| 11-15 | OK | Justify |
| 16-20 | Justify | HIGH |
| 21+ | HIGH | CRITICAL |

---

### Step 8: React patterns review (renderer files only)

**Reference:** `reference/code-review-standards-2025.md` Section 4

**8.1 Hooks rules:**
```
Grep(pattern="if.*use[A-Z]|for.*use[A-Z]", path="src/renderer/")
→ CRITICAL - "Conditional hook call"

Grep(pattern="useEffect\\([^,]+,\\s*\\[\\]\\)", path="src/renderer/")
→ Verify empty deps is intentional
```

**8.2 Performance patterns:**
```
# Inline objects/functions in JSX
Read each .tsx file, check for:
- Object literals in props: prop={{...}}
- Inline functions: onClick={() => ...} (without useCallback)
→ Flag as MEDIUM if passed to memoized children
```

**8.3 Security:**
```
Grep(pattern="dangerouslySetInnerHTML", path="src/renderer/")
→ CRITICAL if not sanitized with DOMPurify
```

---

### Step 9: Node.js patterns review (main/shared files)

**Reference:** `reference/code-review-standards-2025.md` Section 3

**9.1 Async patterns:**
```
Grep(pattern="await.*(?!try)", path="src/main/")
→ Verify await calls are in try/catch

Grep(pattern="\\.then\\(.*\\.catch", path="src/main/")
→ Verify promise chains have error handling
```

**9.2 Performance:**
```
Grep(pattern="for.*await|forEach.*await", path="src/main/")
→ Flag sequential awaits that could be parallel as MEDIUM
```

---

### Step 10: Test coverage review

**Reference:** `reference/code-review-standards-2025.md` Section 9

For each new/modified file:
- [ ] Corresponding .test.ts exists
- [ ] Tests cover acceptance criteria (if provided)
- [ ] Edge cases tested

```
# Run coverage on changed files
npm run test:cov -- --collectCoverageFrom="<pattern>"
```

**Thresholds:**
| Metric | Tier 1 | Tier 2 |
|--------|--------|--------|
| Lines | ≥70% | ≥80% |
| Branches | ≥60% | ≥70% |

---

### Step 11: Documentation review

**Reference:** `reference/code-review-standards-2025.md` Section 10

**Tier 1:** Check for JSDoc on exported functions
**Tier 2:** Also check:
- Complex logic has "why" comments
- Public APIs fully documented
- No outdated comments

---

### Step 12: Compile findings

Aggregate all findings with proper severity and categorization.

**Severity mapping:**
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Security | Injection, secrets | Missing validation | Weak validation | Best practice |
| TypeScript | Unsafe any + user data | any usage | Missing types | Type refinement |
| Architecture | Circular deps | SOLID violation | Coupling | Style |
| Performance | Memory leak | O(n²) large data | Unnecessary render | Minor opt |
| Testing | No tests critical path | Coverage < threshold | Missing edge case | Organization |

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| review_status | string | "approved" / "changes_requested" / "blocked" |
| summary | object | Counts by severity |
| findings | array | All findings with details |
| blocking_issues | array | Issues that MUST be fixed |
| recommendations | array | Non-blocking suggestions |
| metrics | object | Complexity, coverage, coupling |

### Review Status Logic

- `blocked`: Has CRITICAL issues (security, Electron config)
- `changes_requested`: Has HIGH issues OR coverage below threshold
- `approved`: No CRITICAL/HIGH, all thresholds met

### Finding Structure

```json
{
  "id": "SEC-001",
  "severity": "critical|high|medium|low",
  "category": "security|typescript|solid|smells|complexity|react|nodejs|testing|docs",
  "file": "path/to/file.ts",
  "line": 42,
  "rule": "no-hardcoded-secrets",
  "issue": "Description of the issue",
  "evidence": "Code snippet or pattern matched",
  "suggestion": "How to fix",
  "reference": "Section in code-review-standards-2025.md"
}
```

### Output Format

```json
{
  "review_status": "changes_requested",
  "summary": {
    "critical": 0,
    "high": 2,
    "medium": 5,
    "low": 3
  },
  "findings": [
    {
      "id": "TS-001",
      "severity": "high",
      "category": "typescript",
      "file": "src/main/services/FileService.ts",
      "line": 45,
      "rule": "no-any",
      "issue": "Using 'any' type for user input",
      "evidence": "function handleInput(data: any)",
      "suggestion": "Define explicit type or use 'unknown' with validation",
      "reference": "Section 5.1"
    }
  ],
  "blocking_issues": [],
  "recommendations": [
    "Consider extracting validation logic to shared module"
  ],
  "metrics": {
    "max_complexity": 12,
    "avg_complexity": 5.2,
    "line_coverage": 82,
    "branch_coverage": 71,
    "coupling_score": "low"
  }
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All files_changed reviewed
- [ ] All applicable dimensions checked
- [ ] review_status determined
- [ ] findings properly categorized
- [ ] blocking_issues extracted from findings
- [ ] metrics calculated

### Escalation

If ANY of these conditions:
- CRITICAL issue found → review_status = "blocked"
- > 5 HIGH issues → Recommend architectural review
- Coverage < 50% → Flag for discussion

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 1000 tokens |
| Maximum | 1500 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| File not found | Skip file, note in output |
| Too many files (>30) | Prioritize: main > renderer > shared > tests |
| Complexity tool fails | Use manual estimation |
| Coverage unavailable | Note limitation, don't block |

---

## Integration Points

This agent is called from:
- **Phase 7 (Quality Review)** - Full review for implementations
- **Review operation** - Standalone reviews at any time
- **Pre-commit hooks** - Quick security scan

### Phase 7 Integration

When called from Phase 7:
1. Execute Steps 1-12
2. Return structured output
3. Phase 7 evaluates QG-7 based on output

---

## Example

**Input:**
```json
{
  "files_changed": [
    "src/main/services/FileService.ts",
    "src/renderer/src/components/Editor.tsx",
    "src/main/services/FileService.test.ts"
  ],
  "tier": 2,
  "context": {
    "issue_number": 42,
    "acceptance_criteria": ["File save works", "Error shown on failure"]
  }
}
```

**Execution trace:**
```
Step 1: Categorize
→ FileService.ts → Main Process
→ Editor.tsx → Renderer
→ FileService.test.ts → Test

Step 2: Electron security (FileService.ts)
→ Grep for nodeIntegration: No matches
→ Check IPC handlers: 2 found, both validate sender ✓

Step 3: General security
→ Grep for secrets: No matches ✓
→ Grep for injection: No matches ✓

Step 4: TypeScript safety
→ Grep for any: 1 match at line 45 (HIGH)
→ Grep for as: 0 matches ✓

Step 5: SOLID
→ FileService: 180 lines (OK)
→ No switch on type ✓
→ 1 direct instantiation (MEDIUM)

Step 6: Code smells
→ No methods > 50 lines ✓
→ No magic numbers ✓

Step 7: Complexity
→ Max: 8, Avg: 4.2 (OK)

Step 8: React patterns (Editor.tsx)
→ No conditional hooks ✓
→ 1 inline function without useCallback (MEDIUM)

Step 9: Node.js patterns
→ All awaits in try/catch ✓

Step 10: Test coverage
→ FileService: 85% lines, 72% branches (OK)

Step 11: Documentation
→ Public methods documented ✓
```

**Output:**
```json
{
  "review_status": "changes_requested",
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 0
  },
  "findings": [
    {
      "id": "TS-001",
      "severity": "high",
      "category": "typescript",
      "file": "src/main/services/FileService.ts",
      "line": 45,
      "rule": "no-any",
      "issue": "Using 'any' type",
      "suggestion": "Define explicit FileData type"
    },
    {
      "id": "DIP-001",
      "severity": "medium",
      "category": "solid",
      "file": "src/main/services/FileService.ts",
      "line": 12,
      "rule": "dependency-inversion",
      "issue": "Direct instantiation of Logger",
      "suggestion": "Inject Logger via constructor"
    },
    {
      "id": "REACT-001",
      "severity": "medium",
      "category": "react",
      "file": "src/renderer/src/components/Editor.tsx",
      "line": 67,
      "rule": "inline-function",
      "issue": "Inline function in props",
      "suggestion": "Use useCallback if passed to memoized child"
    }
  ],
  "blocking_issues": [],
  "recommendations": [
    "Consider creating FileData interface in shared types"
  ],
  "metrics": {
    "max_complexity": 8,
    "avg_complexity": 4.2,
    "line_coverage": 85,
    "branch_coverage": 72,
    "coupling_score": "low"
  }
}
```
